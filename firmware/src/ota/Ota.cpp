#include "ota/Ota.h"

#include <HTTPClient.h>
#include <Preferences.h>
#include <Update.h>
#include <WiFi.h>
#include <esp_ota_ops.h>


#include "core/SafeMode.h"
#include "core/Watchdog.h"
#include "hmi/Feedback.h"
#include "net/Uplink.h"
#include "ota/Signature.h"
#include "platform/Health.h"
#include "platform/Log.h"
#include "platform/Validate.h"
#include "platform/config.h"

/**
 * Takes the rollback decision away from the Arduino core.
 *
 * This is not optional, and finding that out cost an evening. `initArduino()`
 * runs before setup(), and by default it finds any image in PENDING_VERIFY and
 * immediately marks it valid -- its `verifyOta()` hook returns true and checks
 * nothing. So the A/B partitions, the bootloader support and every line of the
 * probation logic below were decorative: by the time our code could look, the
 * image was already confirmed and the rollback disarmed. The only symptom was
 * a boot log that said "valid" where it should have said "pending-verify".
 *
 * Returning true here defers the decision to us, where it belongs: an image is
 * good once it has run for a while and talked to the server, not because it
 * reached the first line of setup().
 */
extern "C" bool verifyRollbackLater() { return true; }

/**
 * What this image is, in plain text inside the image itself.
 *
 * The server reads it from an uploaded image instead of trusting a filename or
 * a form field: the version it will offer, the build it will match, and the
 * host the image talks to -- an image built for the development server is
 * refused by production, so a mix-up cannot ship. Logged at boot, which also
 * keeps the linker from discarding it.
 */
extern "C" __attribute__((used)) const char kScancartImageTag[] =
    "SCANCART-IMAGE|fw=" FIRMWARE_VERSION "|build=" SCANCART_BUILD "|hw=" HW_REVISION
    "|host=" SCANCART_HOST "|";

namespace {

constexpr const char *kPrefs = "ota";

bool probation = false;
uint32_t serverContacts = 0;
uint32_t probationStartedAt = 0;

OtaPolicy::Scheduler scheduler;
bool downloading = false;
String lastError;
String loggedOffer;

/**
 * The version about to be booted into, written just before the restart, and
 * the version that wrote it. On the next boot exactly one of three things is
 * true: we are the new version (on probation -- wait), we are the old version
 * again (the new one was rolled back -- reject it), or we are something else
 * entirely (flashed by cable -- forget it).
 */
void rememberPending(const char *version) {
  Preferences prefs;
  prefs.begin(kPrefs, false);
  prefs.putString("pending", version);
  prefs.putString("from", FIRMWARE_VERSION);
  prefs.end();
}

void forgetPending() {
  Preferences prefs;
  prefs.begin(kPrefs, false);
  prefs.remove("pending");
  prefs.remove("from");
  prefs.end();
}

String readKey(Preferences &prefs, const char *key) {
  // isKey first: a missing key otherwise logs an error on every boot.
  return prefs.isKey(key) ? prefs.getString(key, "") : String();
}

void settlePendingUpdate(esp_ota_img_states_t state) {
  Preferences prefs;
  prefs.begin(kPrefs, false);
  const String pending = readKey(prefs, "pending");
  const String from = readKey(prefs, "from");
  String rejected = readKey(prefs, "rejected");

  if (pending.length() > 0) {
    if (pending == FIRMWARE_VERSION) {
      // We are the update. Probation decides; tick() clears this on success.
      if (state != ESP_OTA_IMG_PENDING_VERIFY) {
        prefs.remove("pending");
        prefs.remove("from");
      }
    } else if (from == FIRMWARE_VERSION) {
      // Back on the version that installed it: the update did not survive.
      LOG_C("ota", Err::OtaRolledBack, "update to %s was rolled back; it will not be installed again",
            pending.c_str());
      Health::countError(Err::OtaRolledBack);
      rejected = pending;
      prefs.putString("rejected", rejected);
      prefs.remove("pending");
      prefs.remove("from");
    } else {
      // Neither: someone flashed a different image by cable. Not a verdict on
      // the pending version.
      prefs.remove("pending");
      prefs.remove("from");
    }
  }
  prefs.end();
  scheduler.reject(rejected.length() > 0 ? rejected.c_str() : nullptr);
}

void confirmedNewImage() {
  forgetPending();
  // A rejection of something this image already supersedes is history, not a
  // rule: drop it so the heartbeat stops reporting it.
  const char *rejected = scheduler.rejected();
  if (rejected[0] != '\0' && !OtaPolicy::isNewer(rejected, FIRMWARE_VERSION)) {
    Preferences prefs;
    prefs.begin(kPrefs, false);
    prefs.remove("rejected");
    prefs.end();
    scheduler.reject(nullptr);
  }
}

/**
 * Where HTTPClient::writeToStream() delivers a body.
 *
 * Bodies are never read off the raw socket: Vercel streams every function
 * response chunked, whatever Content-Length the function set, and the raw
 * stream of a chunked reply has chunk headers mixed into it. writeToStream()
 * decodes both framings, so the same code handles either.
 */
class Sink : public Stream {
 public:
  size_t write(uint8_t b) override { return write(&b, 1); }
  int available() override { return 0; }
  int read() override { return -1; }
  int peek() override { return -1; }
  void flush() override {}
  using Print::write;
};

/** A small body (the signature) into a fixed buffer. Overflow is a failure. */
class BufferSink : public Sink {
 public:
  BufferSink(uint8_t *out, size_t capacity) : out_(out), capacity_(capacity) {}
  size_t write(const uint8_t *data, size_t length) override {
    if (length > capacity_ - length_) {
      overflowed_ = true;
      return 0;
    }
    memcpy(out_ + length_, data, length);
    length_ += length;
    return length;
  }
  size_t length() const { return length_; }
  bool overflowed() const { return overflowed_; }

 private:
  uint8_t *out_;
  size_t capacity_;
  size_t length_ = 0;
  bool overflowed_ = false;
};

/**
 * The image, straight into the inactive slot and the hash, as it arrives.
 *
 * Hashed on the way past rather than read back afterwards: the image is
 * megabytes and the heap is not, and re-reading flash would only prove what
 * was stored, not what arrived. Refuses a single byte past the offered size.
 */
class FlashSink : public Sink {
 public:
  FlashSink(Signature::Digest &digest, size_t expected) : digest_(digest), expected_(expected) {}

  size_t write(const uint8_t *data, size_t length) override {
    // Called for every block of the download, which can legitimately outlast
    // the watchdog window several times over.
    Watchdog::feed();
    Feedback::tick();
    if (!error_.isEmpty()) return 0;
    if (length > expected_ - written_) {
      error_ = "longer than offered";
      return 0;
    }
    if (Update.write(const_cast<uint8_t *>(data), length) != length) {
      error_ = String("flash write: ") + Update.errorString();
      return 0;
    }
    digest_.update(data, length);
    written_ += length;
    if (quarter_ < 4 && written_ * 4 >= expected_ * quarter_) {
      LOG_I("ota", "%u%%", quarter_ * 25u);
      quarter_++;
    }
    return length;
  }

  size_t written() const { return written_; }
  const String &error() const { return error_; }

 private:
  Signature::Digest &digest_;
  size_t expected_;
  size_t written_ = 0;
  unsigned quarter_ = 1;
  String error_;
};

/** A signed GET to our own host. False with `error` set if it is not a 200. */
bool get(HTTPClient &http, WiFiClient &client, const String &url, const char *what, String &error) {
  // Under the watchdog's 30s: a stalled read gives up before the board resets.
  http.setTimeout(OTA_HTTP_TIMEOUT_MS);
  if (!http.begin(client, url)) {
    error = String(what) + ": no connection";
    return false;
  }
  Uplink::sign(http, "");
  const int status = http.GET();
  if (status != 200) {
    error = String(what) + ": http " + String(status);
    http.end();
    return false;
  }
  return true;
}

/**
 * Fetches the detached signature that sits beside every published image.
 *
 * Fetched first: a published image without a signature is a release mistake,
 * and finding it costs one small request instead of the whole transfer.
 */
bool fetchSignature(const String &url, uint8_t *out, size_t capacity, size_t &lengthOut,
                    String &error) {
  auto client = Uplink::newClient();
  HTTPClient http;
  if (!get(http, *client, url + ".sig", "signature", error)) {
    LOG_E("ota", Err::OtaBadSignature, "no signature for this image (%s)", error.c_str());
    return false;
  }
  BufferSink sink(out, capacity);
  const int result = http.writeToStream(&sink);
  http.end();
  lengthOut = sink.length();
  if (result < 0 || sink.overflowed() || lengthOut < 8) {
    error = sink.overflowed() ? String("signature: too long")
                              : "signature: " + HTTPClient::errorToString(result);
    LOG_E("ota", Err::OtaBadSignature, "could not read the signature (%s)", error.c_str());
    return false;
  }
  return true;
}

String toHex(const uint8_t *bytes, size_t length) {
  static const char digits[] = "0123456789abcdef";
  String out;
  out.reserve(length * 2);
  for (size_t i = 0; i < length; i++) {
    out += digits[bytes[i] >> 4];
    out += digits[bytes[i] & 0x0F];
  }
  return out;
}

/** The whole install. Returns only on failure, with `error` set. */
bool install(const OtaPolicy::Offer &offer, String &error) {
  const String url = String(SCANCART_HOST) + offer.path;
  if (!Validate::urlUnderHost(url)) {
    // The policy already refused anything outside our firmware route; this is
    // the same rule checked once more, where the URL is finally put together.
    error = "url outside our host";
    LOG_E("ota", Err::OtaFailed, "refusing an update from a host we do not trust");
    return false;
  }

  uint8_t signature[80];
  size_t signatureLength = 0;
  if (!fetchSignature(url, signature, sizeof(signature), signatureLength, error)) return false;

  Feedback::setState(Feedback::State::Updating);
  LOG_I("ota", "updating %s -> %s (%u bytes)", FIRMWARE_VERSION, offer.version,
        static_cast<unsigned>(offer.size));

  auto client = Uplink::newClient();
  HTTPClient http;
  if (!get(http, *client, url, "download", error)) {
    LOG_E("ota", Err::OtaFailed, "download failed (%s)", error.c_str());
    return false;
  }

  // A declared length that disagrees with the offer is a different image;
  // finding that out now saves writing it to flash first. (Usually there is
  // none -- the reply is chunked -- and the count is checked at the end.)
  const int declared = http.getSize();
  if (declared > 0 && static_cast<uint32_t>(declared) != offer.size) {
    error = "size " + String(declared) + ", offered " + String(offer.size);
    LOG_E("ota", Err::OtaFailed, "image is %d bytes, the offer said %u", declared,
          static_cast<unsigned>(offer.size));
    http.end();
    return false;
  }

  // U_FLASH writes to the inactive slot; the running firmware is untouched.
  if (!Update.begin(offer.size, U_FLASH)) {
    error = String("no room: ") + Update.errorString();
    LOG_E("ota", Err::OtaFailed, "no room for the image: %s", Update.errorString());
    http.end();
    return false;
  }

  Signature::Digest digest;
  FlashSink sink(digest, offer.size);
  const uint32_t startedAt = millis();
  const int result = http.writeToStream(&sink);
  http.end();

  if (!sink.error().isEmpty() || result < 0 || sink.written() != offer.size) {
    error = !sink.error().isEmpty() ? sink.error()
            : result < 0            ? "download: " + HTTPClient::errorToString(result)
                                    : "short: " + String(sink.written());
    LOG_E("ota", Err::OtaFailed, "download failed at %u of %u bytes (%s)",
          static_cast<unsigned>(sink.written()), static_cast<unsigned>(offer.size), error.c_str());
    Update.abort();
    return false;
  }

  uint8_t hash[32];
  digest.finish(hash);
  const String hex = toHex(hash, sizeof(hash));
  LOG_I("ota", "downloaded in %us", static_cast<unsigned>((millis() - startedAt) / 1000));

  // Before end(), which is what switches the boot slot. An image that fails
  // either check has been written to flash but is never made bootable, and
  // the next update overwrites it.
  if (hex != offer.sha256) {
    error = "sha256 mismatch";
    LOG_E("ota", Err::OtaFailed, "image is not the one offered (sha256 %s)", hex.c_str());
    Update.abort();
    return false;
  }
  if (!Signature::verify(hash, signature, signatureLength)) {
    error = "bad signature";
    LOG_C("ota", Err::OtaBadSignature, "image discarded: it was not signed by us");
    Health::countError(Err::OtaBadSignature);
    Update.abort();
    return false;
  }
  if (!Update.end()) {
    error = String("image check: ") + Update.errorString();
    LOG_E("ota", Err::OtaFailed, "image failed its own checks: %s", Update.errorString());
    return false;
  }

  rememberPending(offer.version);
  LOG_I("ota", "signed image %s installed; restarting into it", offer.version);
  SafeMode::expectRestart();
  delay(200);
  ESP.restart();
  return true;
}

}  // namespace

namespace Ota {

void begin() {
  LOG_I("ota", "%s", kScancartImageTag);
  if (!Signature::selfTest()) {
    // Not fatal to this boot, but it means no update will ever install. Worth
    // shouting about, because the symptom otherwise appears months later as
    // "updates silently do nothing".
    LOG_C("ota", Err::OtaBadSignature, "the signing key is unusable; updates are disabled");
  }

  const esp_partition_t *running = esp_ota_get_running_partition();
  esp_ota_img_states_t state;
  if (esp_ota_get_state_partition(running, &state) != ESP_OK) {
    LOG_W("ota", Err::None, "running from %s; its image state is unreadable", running->label);
    settlePendingUpdate(ESP_OTA_IMG_UNDEFINED);
    return;
  }

  // Reported every boot, not only when something is wrong. Whether the
  // rollback net is actually armed is not something to assume from the
  // absence of a warning -- that is how a safety feature turns out to have
  // been decorative all along.
  static const char *kStates[] = {"new", "pending-verify", "valid", "invalid", "aborted"};
  LOG_I("ota", "running from %s, image is %s", running->label,
        state <= ESP_OTA_IMG_ABORTED ? kStates[state] : "undefined");

  settlePendingUpdate(state);

  if (state == ESP_OTA_IMG_PENDING_VERIFY) {
    probation = true;
    probationStartedAt = millis();
    LOG_W("ota", Err::None, "this image is on probation: %us to prove itself",
          OTA_PROBATION_GIVEUP_MS / 1000);
  }
}

bool onProbation() { return probation; }

void noteServerContact() {
  if (probation) serverContacts++;
}

void tick() {
  if (!probation) return;

  const uint32_t elapsed = millis() - probationStartedAt;

  // Both conditions, not either. Uptime alone would pass firmware that boots
  // and then cannot reach anything; server contacts alone would pass firmware
  // that talks to us for thirty seconds and then falls over.
  if (elapsed >= OTA_PROBATION_MS && serverContacts >= OTA_PROBATION_CONTACTS) {
    esp_ota_mark_app_valid_cancel_rollback();
    probation = false;
    confirmedNewImage();
    LOG_I("ota", "image confirmed after %us and %u exchanges; rollback disarmed",
          elapsed / 1000, serverContacts);
    return;
  }

  if (elapsed >= OTA_PROBATION_GIVEUP_MS) {
    // The bootloader only rolls back when the device restarts, so an image
    // that is broken but not crashing would otherwise sit here forever. Ask
    // for the rollback explicitly instead of waiting for a power cut.
    LOG_C("ota", Err::OtaRolledBack,
          "unproven after %us (%u exchanges); going back to the previous image",
          elapsed / 1000, serverContacts);
    Health::countError(Err::OtaRolledBack);
    SafeMode::expectRestart();
    delay(200);
    esp_ota_mark_app_invalid_rollback_and_reboot();
  }
}

Status status() {
  Status s{"idle", String(), String(scheduler.rejected()), String()};
  if (probation) {
    s.state = "probation";
    s.target = FIRMWARE_VERSION;
  } else if (downloading) {
    s.state = "downloading";
    s.target = scheduler.current().version;
  } else if (scheduler.wanted(FIRMWARE_VERSION)) {
    s.target = scheduler.current().version;
    if (scheduler.failures() > 0) {
      s.state = "failed";
      s.error = lastError.substring(0, 80);
    } else {
      s.state = "pending";
    }
  }
  return s;
}

void offer(const char *version, const char *path, uint32_t size, const char *sha256) {
  if (!scheduler.offer(version, path, size, sha256)) {
    LOG_W("ota", Err::BadResponse, "update offer was malformed; ignoring it");
    loggedOffer = "";
    return;
  }
  if (loggedOffer != version) {
    loggedOffer = version;
    lastError = "";
    if (scheduler.wanted(FIRMWARE_VERSION)) {
      LOG_I("ota", "update %s offered (%u bytes); installing at the next quiet moment", version,
            static_cast<unsigned>(size));
    } else {
      LOG_I("ota", "update %s offered, but not for this image (rejected or not newer)", version);
    }
  }
}

void withdrawOffer() {
  if (scheduler.hasOffer()) LOG_I("ota", "update offer withdrawn");
  scheduler.withdraw();
  loggedOffer = "";
}

bool updateDue(const OtaPolicy::Moment &moment) { return scheduler.due(moment, FIRMWARE_VERSION); }

bool installOffered() {
  // A copy: the scheduler may be told something new while we work.
  const OtaPolicy::Offer offer = scheduler.current();
  downloading = true;
  String error;
  install(offer, error);  // returns only on failure

  downloading = false;
  lastError = error.length() > 0 ? error : String("unknown");
  scheduler.failed(millis());
  Health::countError(Err::OtaFailed);
  LOG_W("ota", Err::OtaFailed, "update to %s failed (%s); attempt %u, will retry later",
        offer.version, lastError.c_str(), scheduler.failures());
  return false;
}

}  // namespace Ota

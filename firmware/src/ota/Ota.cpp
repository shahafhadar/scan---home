#include "ota/Ota.h"

#include <HTTPClient.h>
#include <Update.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_ota_ops.h>

#include <memory>

#include "core/SafeMode.h"
#include "core/Watchdog.h"
#include "hmi/Feedback.h"
#include "ota/Signature.h"
#include "platform/Health.h"
#include "platform/Log.h"
#include "platform/Validate.h"
#include "platform/certs.h"
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

namespace {

bool probation = false;
uint32_t serverContacts = 0;
uint32_t probationStartedAt = 0;

std::unique_ptr<WiFiClient> makeClient() {
  if (String(SCANCART_HOST).startsWith("http://")) {
    return std::unique_ptr<WiFiClient>(new WiFiClient());
  }
  auto secure = std::unique_ptr<WiFiClientSecure>(new WiFiClientSecure());
  secure->setCACert(CA_BUNDLE);
  return std::unique_ptr<WiFiClient>(secure.release());
}

/**
 * Fetches the detached signature that sits beside every published image.
 *
 * Deliberately a separate file rather than a field in the update command: an
 * image and its signature are then one artifact that cannot be published half
 * way, and a release that forgets to sign simply fails to install instead of
 * installing unchecked.
 */
bool fetchSignature(const String &url, uint8_t *out, size_t capacity, size_t &lengthOut) {
  auto client = makeClient();
  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(*client, url + ".sig")) return false;

  const int status = http.GET();
  if (status != 200) {
    LOG_E("ota", Err::OtaBadSignature, "no signature published for this image (%d)", status);
    http.end();
    return false;
  }

  const int size = http.getSize();
  if (size <= 0 || static_cast<size_t>(size) > capacity) {
    LOG_E("ota", Err::OtaBadSignature, "signature is %d bytes, which is not a signature", size);
    http.end();
    return false;
  }

  WiFiClient *stream = http.getStreamPtr();
  size_t read = 0;
  const uint32_t deadline = millis() + HTTP_TIMEOUT_MS;
  while (read < static_cast<size_t>(size) && millis() < deadline) {
    const int n = stream->read(out + read, size - read);
    if (n > 0) read += n;
    else delay(5);
  }
  http.end();

  lengthOut = read;
  return read == static_cast<size_t>(size);
}

}  // namespace

namespace Ota {

void begin() {
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
    return;
  }

  // Reported every boot, not only when something is wrong. Whether the
  // rollback net is actually armed is not something to assume from the
  // absence of a warning -- that is how a safety feature turns out to have
  // been decorative all along.
  static const char *kStates[] = {"new", "pending-verify", "valid", "invalid", "aborted"};
  LOG_I("ota", "running from %s, image is %s", running->label,
        state <= ESP_OTA_IMG_ABORTED ? kStates[state] : "undefined");

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

bool applyUpdate(const String &url, const String &expectedVersion) {
  if (!Validate::urlUnderHost(url)) {
    // Whatever the command said, firmware only ever comes from our own host.
    LOG_E("ota", Err::OtaFailed, "refusing an update from a host we do not trust");
    return false;
  }
  if (expectedVersion.length() > 0 && !Validate::version(expectedVersion)) {
    LOG_E("ota", Err::OtaFailed, "update command carried a nonsense version");
    return false;
  }
  if (expectedVersion == FIRMWARE_VERSION) {
    LOG_I("ota", "already on this version");
    return false;
  }
  if (probation) {
    // Chaining an unproven image onto another unproven image loses the only
    // known-good copy we have left.
    LOG_W("ota", Err::OtaFailed, "still proving the current image; not updating yet");
    return false;
  }

  // Before spending two minutes on a download. A published image without a
  // published signature is a release mistake, and finding it first costs one
  // request instead of the whole transfer.
  uint8_t signature[80];
  size_t signatureLength = 0;
  if (!fetchSignature(url, signature, sizeof(signature), signatureLength)) return false;

  Feedback::setState(Feedback::State::Updating);
  LOG_I("ota", "updating to %s", expectedVersion.c_str());

  auto client = makeClient();
  HTTPClient http;
  http.setTimeout(30000);
  if (!http.begin(*client, url)) return false;

  const int status = http.GET();
  if (status != 200) {
    LOG_E("ota", Err::OtaFailed, "download failed with status %d", status);
    http.end();
    return false;
  }

  const int length = http.getSize();
  if (length <= 0) {
    LOG_E("ota", Err::OtaFailed, "the server did not say how big the image is");
    http.end();
    return false;
  }

  // U_FLASH writes to the inactive slot; the running firmware is untouched.
  if (!Update.begin(length, U_FLASH)) {
    LOG_E("ota", Err::OtaFailed, "no room for the image: %s", Update.errorString());
    http.end();
    return false;
  }

  // Hashed on the way past rather than read back afterwards: the image is
  // megabytes and the heap is not, and re-reading flash to hash it would only
  // prove what was stored, not what arrived.
  Signature::Digest digest;
  WiFiClient *stream = http.getStreamPtr();
  uint8_t buffer[1024];
  size_t written = 0;
  uint32_t lastProgress = millis();

  while (written < static_cast<size_t>(length)) {
    // A slow network must not look like a hung device. The download can
    // legitimately outlast the watchdog window several times over.
    Watchdog::feed();
    Feedback::tick();

    const size_t want = min(sizeof(buffer), static_cast<size_t>(length) - written);
    const int n = stream->readBytes(buffer, want);
    if (n <= 0) {
      if (millis() - lastProgress > OTA_STALL_TIMEOUT_MS) {
        LOG_E("ota", Err::OtaFailed, "download stalled at %u of %d bytes", written, length);
        Update.abort();
        http.end();
        return false;
      }
      delay(10);
      continue;
    }

    if (Update.write(buffer, n) != static_cast<size_t>(n)) {
      LOG_E("ota", Err::OtaFailed, "flash write failed: %s", Update.errorString());
      Update.abort();
      http.end();
      return false;
    }
    digest.update(buffer, n);
    written += n;
    lastProgress = millis();
  }
  http.end();

  uint8_t hash[32];
  digest.finish(hash);

  // Before end(), which is what switches the boot slot. An image that fails
  // here has been written to flash but is never made bootable, and the next
  // update overwrites it.
  if (!Signature::verify(hash, signature, signatureLength)) {
    LOG_C("ota", Err::OtaBadSignature, "image discarded: it was not signed by us");
    Health::countError(Err::OtaBadSignature);
    Update.abort();
    return false;
  }

  if (!Update.end()) {
    LOG_E("ota", Err::OtaFailed, "image failed its own checks: %s", Update.errorString());
    return false;
  }

  LOG_I("ota", "signed image installed; restarting into it");
  SafeMode::expectRestart();
  delay(200);
  ESP.restart();
  return true;
}

}  // namespace Ota

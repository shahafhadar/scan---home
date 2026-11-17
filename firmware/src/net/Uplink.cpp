#include "net/Uplink.h"

#include <ArduinoJson.h>
#include "data/ScanQueue.h"
#include <HTTPClient.h>
#include <WiFi.h>
#include <time.h>
#include <WiFiClientSecure.h>
#include <memory>
#include <mbedtls/md.h>

#include "core/BootInfo.h"
#include "core/SafeMode.h"
#include "core/SelfTest.h"
#include "device/DeviceIdentity.h"
#include "ota/Ota.h"
#include "platform/Health.h"
#include "platform/Log.h"
#include "net/BoundedBody.h"
#include "platform/certs.h"
#include "platform/config.h"

namespace {

// True while pointing at a plain-http server, which only ever happens during
// bring-up against a laptop on the same network. A shipped device talks to an
// https host and therefore verifies its certificate.
bool insecureHost() { return String(SCANCART_HOST).startsWith("http://"); }

/**
 * The right client for the host we were built against. Kept in one place so
 * no call site has to know or care which it got.
 */
std::unique_ptr<WiFiClient> makeClient() {
  if (insecureHost()) return std::unique_ptr<WiFiClient>(new WiFiClient());
  auto secure = std::unique_ptr<WiFiClientSecure>(new WiFiClientSecure());
  secure->setCACert(CA_BUNDLE);
  return std::unique_ptr<WiFiClient>(secure.release());
}

String hmacSha256(const String &key, const String &message) {
  uint8_t result[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);
  mbedtls_md_hmac_starts(&ctx, reinterpret_cast<const uint8_t *>(key.c_str()), key.length());
  mbedtls_md_hmac_update(&ctx, reinterpret_cast<const uint8_t *>(message.c_str()), message.length());
  mbedtls_md_hmac_finish(&ctx, result);
  mbedtls_md_free(&ctx);

  static const char digits[] = "0123456789abcdef";
  String out;
  out.reserve(64);
  for (uint8_t i = 0; i < 32; i++) {
    out += digits[result[i] >> 4];
    out += digits[result[i] & 0x0F];
  }
  return out;
}

/** Hands HTTPClient's decoded body to a BoundedBody. Write-only. */
class BodySink : public Stream {
 public:
  explicit BodySink(BoundedBody &body) : body_(body) {}
  size_t write(uint8_t b) override { return body_.append(&b, 1); }
  size_t write(const uint8_t *data, size_t length) override { return body_.append(data, length); }
  int available() override { return 0; }
  int read() override { return -1; }
  int peek() override { return -1; }
  void flush() override {}

 private:
  BoundedBody &body_;
};

/**
 * Reads a response, or refuses to.
 *
 * `http.getString()` is bounded when the server declares a Content-Length --
 * it reserves that much and stops there. It is unbounded for a chunked reply,
 * where it reads until the connection closes. On a device with 300KB of heap
 * that is the difference between a reply and a crash, so the length is checked
 * before a single byte is read, and a reply that will not say how long it is
 * does not get read at all. Our server always declares one.
 *
 * An earlier version of this read the stream by hand to enforce the cap. It
 * also blocked for the full HTTP timeout on every request, because readBytes()
 * waits for the buffer to fill and our replies are a few hundred bytes -- ten
 * seconds of the main loop, per request, to solve a problem the header already
 * answers.
 */
bool readBounded(HTTPClient &http, String &out) {
  out = "";
  const int declared = http.getSize();

  if (declared < 0) {
    // No Content-Length: Vercel streams function replies chunked, whatever
    // the function set. HTTPClient decodes the chunks into a sink that stops
    // taking bytes at the cap, so the bound still holds.
    BoundedBody body(out, MAX_RESPONSE_BYTES);
    BodySink sink(body);
    const int written = http.writeToStream(&sink);
    if (body.overflowed()) {
      LOG_W("net", Err::ResponseTooLarge, "chunked response over %d bytes; not reading it",
            MAX_RESPONSE_BYTES);
      Health::countError(Err::ResponseTooLarge);
      out = "";
      return false;
    }
    if (written < 0) {
      LOG_W("net", Err::BadResponse, "chunked response could not be read (%d)", written);
      out = "";
      return false;
    }
    return true;
  }
  if (declared > MAX_RESPONSE_BYTES) {
    LOG_W("net", Err::ResponseTooLarge, "server announced %d bytes; not reading it", declared);
    Health::countError(Err::ResponseTooLarge);
    return false;
  }

  out = http.getString();
  return true;
}

/**
 * One signed request. `body` is sent byte for byte as given: the signature
 * covers those exact bytes, so re-encoding it anywhere in between would break
 * verification on the server.
 */
int request(const char *method, const char *path, const String &body, String &responseOut) {
  auto client = makeClient();
  client->setTimeout(HTTP_TIMEOUT_MS / 1000);

  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(*client, String(SCANCART_HOST) + path)) return -1;

  const String timestamp = String(static_cast<uint32_t>(time(nullptr)));
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Id", DeviceIdentity::serial());
  http.addHeader("X-Timestamp", timestamp);
  http.addHeader("X-Signature", hmacSha256(DeviceIdentity::secretHash(), timestamp + "." + body));
#ifdef SCANCART_BYPASS
  http.addHeader("x-vercel-protection-bypass", SCANCART_BYPASS);
#endif

  const int status = strcmp(method, "GET") == 0 ? http.GET() : http.POST(body);
  if (status > 0 && !readBounded(http, responseOut)) {
    http.end();
    return -1;
  }
  http.end();
  return status;
}

}  // namespace

namespace Uplink {

void begin() {
  if (insecureHost()) {
    LOG_W("net", Err::None, "plain http: no certificate is being checked");
    LOG_W("net", Err::None, "bring-up only -- never ship a device built this way");
  }
}

bool registerDevice(const String &claimToken, String &pairingCodeOut, bool &claimedOut) {
  claimedOut = false;
  JsonDocument doc;
  doc["serial"] = DeviceIdentity::serial();
  doc["secret_hash"] = DeviceIdentity::secretHash();
  doc["firmware_version"] = FIRMWARE_VERSION;
  doc["pairing_code"] = DeviceIdentity::pairingCode();
  if (claimToken.length() > 0) doc["claim_token"] = claimToken;

  String body;
  serializeJson(doc, body);

  // Registration is the one unsigned call: the server has no key for this
  // device yet. It is rate limited, and an unclaimed device can do nothing
  // until a signed-in person types its pairing code.
  auto client = makeClient();
  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(*client, String(SCANCART_HOST) + "/api/v1/devices/register")) return false;
  http.addHeader("Content-Type", "application/json");
#ifdef SCANCART_BYPASS
  http.addHeader("x-vercel-protection-bypass", SCANCART_BYPASS);
#endif
  const int status = http.POST(body);
  String response;
  if (status > 0 && !readBounded(http, response)) {
    http.end();
    return false;
  }
  http.end();

  if (status != 200 && status != 201) {
    LOG_E("net", Err::ServerUnreachable, "registration failed with status %d", status);
    return false;
  }

  JsonDocument parsed;
  if (deserializeJson(parsed, response)) return false;

  // Usually the code we proposed. If another device already had it, the
  // server allocated a different one and the setup page must correct itself.
  pairingCodeOut = parsed["pairing_code"].as<String>();
  claimedOut = parsed["claimed"].as<bool>() || parsed["status"].as<String>() == "active";
  return pairingCodeOut.length() > 0;
}

bool checkClaimed(bool &claimedOut) {
  String response;
  const int status = request("GET", "/api/v1/devices/claim-status", "", response);
  if (status != 200) return false;

  JsonDocument doc;
  if (deserializeJson(doc, response)) return false;
  claimedOut = doc["claimed"].as<bool>();
  return true;
}

ScanResult sendScan(const ScanQueue::Entry &entry, bool fromQueue) {
  ScanResult result;

  JsonDocument doc;
  doc["scan_id"] = entry.scanId;
  doc["barcode"] = entry.barcode;
  doc["symbology"] = "UNKNOWN";
  doc["ts"] = entry.timestamp;
  doc["queued"] = fromQueue;
  if (entry.quantity > 1) doc["quantity"] = entry.quantity;

  String body;
  serializeJson(doc, body);

  String response;
  const int status = request("POST", "/api/v1/scans", body, response);
  if (status != 200 && status != 202) {
    LOG_W("net", Err::ServerUnreachable, "scan upload failed with status %d", status);
    return result;
  }

  result.delivered = true;
  result.held = status == 202;

  JsonDocument parsed;
  if (!deserializeJson(parsed, response)) {
    result.identified = parsed["identified"].as<bool>();
    result.name = parsed["name"].as<String>();
  }
  return result;
}

size_t flushQueue() {
  // Bounded so a device that was offline for a week does not try to build one
  // enormous request; the rest goes on the next pass.
  static constexpr size_t kBatch = 25;
  ScanQueue::Entry entries[kBatch];
  const size_t count = ScanQueue::peek(entries, kBatch);
  if (count == 0) return 0;

  JsonDocument doc;
  JsonArray array = doc["scans"].to<JsonArray>();
  for (size_t i = 0; i < count; i++) {
    JsonObject item = array.add<JsonObject>();
    item["scan_id"] = entries[i].scanId;
    item["barcode"] = entries[i].barcode;
    item["ts"] = entries[i].timestamp;
    item["queued"] = true;
    if (entries[i].quantity > 1) item["quantity"] = entries[i].quantity;
  }

  String body;
  serializeJson(doc, body);

  String response;
  const int status = request("POST", "/api/v1/scans/batch", body, response);
  if (status != 200) {
    LOG_W("net", Err::ServerUnreachable, "queue flush failed with status %d", status);
    return 0;
  }

  JsonDocument parsed;
  if (deserializeJson(parsed, response)) {
    LOG_E("net", Err::BadResponse, "queue flush returned unparseable JSON");
    Health::countError(Err::BadResponse);
    return 0;
  }

  // Only drop what the server actually confirmed.
  JsonArray accepted = parsed["accepted"].as<JsonArray>();
  const size_t acceptedCount = accepted.size();

  String confirmed[kBatch];
  size_t index = 0;
  for (JsonVariant id : accepted) {
    if (index >= kBatch) break;
    confirmed[index++] = id.as<String>();
  }
  if (index > 0) ScanQueue::removeConfirmed(confirmed, index);

  // Everything we offered and did not get back was refused. Counting those
  // refusals is what eventually retires an entry the server will never take,
  // instead of carrying it in every batch forever.
  String refused[kBatch];
  size_t refusedCount = 0;
  for (size_t i = 0; i < count; i++) {
    bool wasAccepted = false;
    for (size_t j = 0; j < index; j++) {
      if (confirmed[j] == entries[i].scanId) { wasAccepted = true; break; }
    }
    if (!wasAccepted) refused[refusedCount++] = entries[i].scanId;
  }
  if (refusedCount > 0) ScanQueue::recordFailure(refused, refusedCount);

  if (acceptedCount > 0) LOG_I("net", "flushed %u queued scans", acceptedCount);
  if (refusedCount > 0) LOG_W("net", Err::ServerRejected, "%u scan(s) refused", refusedCount);
  return acceptedCount;
}

bool heartbeat(bool scannerAttached, uint32_t keysSeen, String &commandOut) {
  JsonDocument doc;
  doc["fw"] = FIRMWARE_VERSION;
  doc["rssi"] = WiFi.RSSI();
  doc["scanner_attached"] = scannerAttached;
  doc["keys_seen"] = keysSeen;

  // Everything needed to judge this device's health from somewhere else. A
  // leak shows as min_heap falling day over day; a loose socket shows as
  // usb_restarts climbing; a flapping router shows as wifi_reconnects.
  doc["uptime"] = BootInfo::uptimeSeconds();
  doc["reset_reason"] = BootInfo::resetReason();
  doc["boot_count"] = BootInfo::bootCount();
  doc["safe_mode"] = SafeMode::active();
  // Not just whether it gave up, but how close it is to giving up. A device
  // reporting three failed boots is a device about to become a support call.
  doc["failed_boots"] = SafeMode::failedBoots();
  doc["ota_probation"] = Ota::onProbation();
  doc["free_heap"] = Health::freeHeap();
  doc["min_heap"] = Health::minFreeHeap();
  doc["queue_size"] = ScanQueue::size();
  doc["queue_failed"] = ScanQueue::failedCount();
  doc["queue_dropped"] = ScanQueue::droppedCount();
  doc["errors"] = Health::totalErrors();
  doc["wifi_reconnects"] = Health::wifiReconnects();
  doc["usb_restarts"] = Health::usbRestarts();
  doc["hw"] = HW_REVISION;
  doc["self_test"] = SelfTest::allPassed();

  String body;
  serializeJson(doc, body);

  String response;
  const int status = request("POST", "/api/v1/devices/heartbeat", body, response);
  if (status != 200) {
    // Said out loud. A heartbeat is also the command channel, so one that
    // fails quietly is a device that stops taking instructions and never
    // mentions it -- which is exactly how an update goes missing.
    LOG_W("net", status > 0 ? Err::ServerRejected : Err::ServerUnreachable,
          "heartbeat failed with status %d", status);
    Health::countError(status > 0 ? Err::ServerRejected : Err::ServerUnreachable);
    return false;
  }

  JsonDocument parsed;
  if (deserializeJson(parsed, response)) {
    LOG_E("net", Err::BadResponse, "heartbeat returned unparseable JSON");
    Health::countError(Err::BadResponse);
    return false;
  }

  Health::markServerSync();
  Ota::noteServerContact();
  if (!parsed["command"].isNull()) {
    serializeJson(parsed["command"], commandOut);
    LOG_I("net", "heartbeat carried a command (%u bytes)", commandOut.length());
  }
  return true;
}

bool sendDiagnostics(const String &json) {
  String response;
  const int status = request("POST", "/api/v1/devices/diagnostics", json, response);
  if (status != 200 && status != 201) {
    LOG_W("net", Err::ServerUnreachable, "diagnostics rejected with status %d", status);
    return false;
  }
  LOG_I("net", "diagnostics sent (%u bytes)", json.length());
  return true;
}

}  // namespace Uplink

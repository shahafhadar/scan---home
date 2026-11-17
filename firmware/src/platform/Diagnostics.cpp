#include "platform/Diagnostics.h"

#include <ArduinoJson.h>
#include <LittleFS.h>
#include <WiFi.h>
#include <esp_flash.h>
#include <esp_ota_ops.h>

#include "core/BootInfo.h"
#include "core/SafeMode.h"
#include "core/SelfTest.h"
#include "data/ScanQueue.h"
#include "device/DeviceIdentity.h"
#include "ota/Ota.h"
#include "platform/ErrorCodes.h"
#include "platform/Health.h"
#include "platform/config.h"

namespace Diagnostics {

String snapshot() {
  JsonDocument doc;

  doc["serial"] = DeviceIdentity::serial();
  doc["firmware"] = FIRMWARE_VERSION;
  doc["hardware"] = HW_REVISION;
  doc["build"] = __DATE__ " " __TIME__;
#if defined(SCANCART_PRODUCTION)
  doc["channel"] = "production";
#else
  doc["channel"] = "development";
#endif

  JsonObject boot = doc["boot"].to<JsonObject>();
  boot["reason"] = BootInfo::resetReason();
  boot["count"] = BootInfo::bootCount();
  boot["uptime"] = BootInfo::uptimeSeconds();
  boot["failed"] = SafeMode::failedBoots();
  boot["safe_mode"] = SafeMode::active();

  JsonObject self = doc["self_test"].to<JsonObject>();
  self["passed"] = SelfTest::allPassed();
  self["bits"] = SelfTest::passed();
  if (!SelfTest::allPassed()) self["failed"] = SelfTest::failureNames();

  JsonObject memory = doc["memory"].to<JsonObject>();
  memory["free"] = Health::freeHeap();
  memory["min_free"] = Health::minFreeHeap();
  memory["largest_block"] = Health::largestFreeBlock();
  memory["psram"] = ESP.getPsramSize();
  memory["psram_free"] = ESP.getFreePsram();

  JsonObject net = doc["network"].to<JsonObject>();
  net["ssid"] = WiFi.SSID();
  net["rssi"] = WiFi.RSSI();
  net["ip"] = WiFi.localIP().toString();
  net["gateway"] = WiFi.gatewayIP().toString();
  net["dns"] = WiFi.dnsIP().toString();
  net["mac"] = WiFi.macAddress();
  net["reconnects"] = Health::wifiReconnects();
  net["host"] = SCANCART_HOST;

  JsonObject storage = doc["storage"].to<JsonObject>();
  uint32_t flashSize = 0;
  esp_flash_get_size(nullptr, &flashSize);
  storage["flash"] = flashSize;
  storage["fs_total"] = LittleFS.totalBytes();
  storage["fs_used"] = LittleFS.usedBytes();

  const esp_partition_t *running = esp_ota_get_running_partition();
  JsonObject image = doc["image"].to<JsonObject>();
  image["partition"] = running != nullptr ? running->label : "?";
  image["probation"] = Ota::onProbation();

  JsonObject queue = doc["queue"].to<JsonObject>();
  queue["size"] = ScanQueue::size();
  queue["failed"] = ScanQueue::failedCount();
  queue["dropped"] = ScanQueue::droppedCount();
  queue["capacity"] = QUEUE_MAX_ENTRIES;

  // Per code, not just a total. "Forty errors" is not a story; "forty E010"
  // is a loose socket and "forty E003" is a server nobody restarted.
  JsonObject errors = doc["errors"].to<JsonObject>();
  errors["total"] = Health::totalErrors();
  JsonObject byCode = errors["by_code"].to<JsonObject>();
  for (uint16_t i = 1; i <= static_cast<uint16_t>(Err::ResponseTooLarge); i++) {
    const Err code = static_cast<Err>(i);
    const uint32_t count = Health::errorCount(code);
    if (count > 0) byCode[errCode(code)] = count;
  }

  // What this build actually believes, as opposed to what the source says
  // today. Diagnosing a device against the wrong constants wastes an afternoon.
  JsonObject config = doc["config"].to<JsonObject>();
  config["heartbeat_ms"] = HEARTBEAT_INTERVAL_MS;
  config["watchdog_s"] = WATCHDOG_TIMEOUT_S;
  config["queue_max"] = QUEUE_MAX_ENTRIES;
  config["queue_retries"] = QUEUE_MAX_RETRIES;
  config["safe_mode_after"] = SAFE_MODE_FAILED_BOOTS;
  config["probation_ms"] = OTA_PROBATION_MS;
  config["probation_giveup_ms"] = OTA_PROBATION_GIVEUP_MS;

  String out;
  serializeJson(doc, out);
  return out;
}

}  // namespace Diagnostics

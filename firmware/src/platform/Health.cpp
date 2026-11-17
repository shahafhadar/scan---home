#include "platform/Health.h"

#include <Arduino.h>
#include <esp_heap_caps.h>

#include "platform/Log.h"
#include "platform/config.h"

namespace {

constexpr size_t kErrorSlots = 16;
uint32_t errorCounts[kErrorSlots] = {0};

uint32_t wifiReconnectCount = 0;
uint32_t usbRestartCount = 0;
uint32_t lastServerSyncMs = 0;
bool everSynced = false;

uint32_t heapAtBoot = 0;
uint32_t lastSampleMs = 0;
uint32_t lastWarnMs = 0;

}  // namespace

namespace Health {

void begin() {
  heapAtBoot = ESP.getFreeHeap();
  LOG_I("health", "free heap at boot: %u bytes", heapAtBoot);
}

void tick() {
  const uint32_t now = millis();
  if (now - lastSampleMs < HEALTH_SAMPLE_INTERVAL_MS) return;
  lastSampleMs = now;

  if (!memoryLooksUnhealthy()) return;
  // Rate limited: a device that is genuinely low on memory would otherwise
  // spend what it has left printing about it.
  if (now - lastWarnMs < HEALTH_WARN_INTERVAL_MS) return;
  lastWarnMs = now;

  LOG_W("health", Err::OutOfMemory, "heap %u, min %u, largest block %u (boot was %u)", freeHeap(),
        minFreeHeap(), largestFreeBlock(), heapAtBoot);
}

void countError(Err error) {
  const auto slot = static_cast<size_t>(error);
  if (slot < kErrorSlots) errorCounts[slot]++;
}

void countWifiReconnect() { wifiReconnectCount++; }
void countUsbRestart() { usbRestartCount++; }

void markServerSync() {
  lastServerSyncMs = millis();
  everSynced = true;
}

uint32_t freeHeap() { return ESP.getFreeHeap(); }
uint32_t minFreeHeap() { return ESP.getMinFreeHeap(); }
uint32_t largestFreeBlock() { return heap_caps_get_largest_free_block(MALLOC_CAP_DEFAULT); }

uint32_t errorCount(Err error) {
  const auto slot = static_cast<size_t>(error);
  return slot < kErrorSlots ? errorCounts[slot] : 0;
}

uint32_t totalErrors() {
  uint32_t total = 0;
  for (size_t i = 1; i < kErrorSlots; i++) total += errorCounts[i];
  return total;
}

uint32_t wifiReconnects() { return wifiReconnectCount; }
uint32_t usbRestarts() { return usbRestartCount; }

uint32_t secondsSinceServerSync() {
  if (!everSynced) return UINT32_MAX;
  return (millis() - lastServerSyncMs) / 1000;
}

bool memoryLooksUnhealthy() {
  // Two separate signals. An absolute floor catches running out; a fall from
  // the boot figure catches a slow leak that has not bitten yet but will.
  if (minFreeHeap() < HEAP_CRITICAL_BYTES) return true;
  if (heapAtBoot > 0 && minFreeHeap() < heapAtBoot / 2) return true;
  // Plenty free overall but no single block worth having is fragmentation,
  // and it fails allocations that the free total says should succeed.
  return largestFreeBlock() < HEAP_MIN_BLOCK_BYTES;
}

}  // namespace Health

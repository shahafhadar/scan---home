#include "data/ScanQueue.h"

#include <ArduinoJson.h>
#include <LittleFS.h>

#include "core/Watchdog.h"
#include "platform/Health.h"
#include "platform/Log.h"
#include "platform/config.h"

namespace {

size_t pendingCount = 0;
size_t failedEntries = 0;
uint32_t dropped = 0;
bool mounted = false;

/** Reads every line once at boot so the counts do not need a scan each time. */
void recount() {
  pendingCount = 0;
  failedEntries = 0;

  File file = LittleFS.open(QUEUE_FILE, "r");
  if (!file) return;

  while (file.available()) {
    const String line = file.readStringUntil('\n');
    if (line.length() == 0) continue;
    // Cheaper than parsing every line at boot, and the only thing we need is
    // which bucket it falls in.
    if (line.indexOf("\"st\":1") >= 0) failedEntries++;
    else pendingCount++;
    Watchdog::feed();
  }
  file.close();
}

void writeEntry(File &file, const ScanQueue::Entry &entry) {
  JsonDocument doc;
  doc["id"] = entry.scanId;
  doc["bc"] = entry.barcode;
  doc["ts"] = entry.timestamp;
  doc["q"] = entry.quantity;
  doc["la"] = entry.lastAttempt;
  doc["r"] = entry.retries;
  doc["st"] = static_cast<uint8_t>(entry.status);
  serializeJson(doc, file);
  file.print('\n');
}

bool readEntry(const String &line, ScanQueue::Entry &out) {
  JsonDocument doc;
  if (deserializeJson(doc, line)) return false;

  out.scanId = doc["id"].as<String>();
  out.barcode = doc["bc"].as<String>();
  out.timestamp = doc["ts"].as<uint32_t>();
  out.quantity = doc["q"].as<uint8_t>();
  out.lastAttempt = doc["la"].as<uint32_t>();
  out.retries = doc["r"].as<uint16_t>();
  out.status = static_cast<ScanQueue::Status>(doc["st"].as<uint8_t>());

  // A line that survived a power cut mid-write can parse and still be
  // nonsense. Without an id there is nothing to deduplicate on, so it is
  // worse than useless.
  return out.scanId.length() > 0 && out.barcode.length() > 0;
}

bool contains(const String *ids, size_t count, const String &id) {
  for (size_t i = 0; i < count; i++) {
    if (ids[i] == id) return true;
  }
  return false;
}

/**
 * Rewrites the file, applying `transform` to each entry.
 *
 * Returning false from the callback drops the entry. Everything that changes
 * the queue goes through here, so there is one place where a power cut can
 * catch us -- and it catches us with the old file still intact, because the
 * rename is the last step.
 */
template <typename Fn>
void rewrite(Fn transform) {
  File source = LittleFS.open(QUEUE_FILE, "r");
  if (!source) return;
  File target = LittleFS.open(QUEUE_TEMP_FILE, "w");
  if (!target) {
    source.close();
    LOG_E("queue", Err::StorageFailure, "could not open a temp file to rewrite the queue");
    return;
  }

  size_t pending = 0;
  size_t failed = 0;

  while (source.available()) {
    Watchdog::feed();
    const String line = source.readStringUntil('\n');
    if (line.length() == 0) continue;

    ScanQueue::Entry entry;
    if (!readEntry(line, entry)) continue;  // corrupt: quietly drop
    if (!transform(entry)) continue;

    writeEntry(target, entry);
    if (entry.status == ScanQueue::Status::Failed) failed++;
    else pending++;
  }

  source.close();
  target.close();
  LittleFS.remove(QUEUE_FILE);
  LittleFS.rename(QUEUE_TEMP_FILE, QUEUE_FILE);

  pendingCount = pending;
  failedEntries = failed;
}

/**
 * Makes room by dropping the oldest pending entry.
 *
 * The old code dropped the newest, which is backwards: the oldest scan is one
 * the person has long since forgotten, and the newest is the item they are
 * holding right now.
 */
void dropOldest() {
  bool removed = false;
  rewrite([&removed](const ScanQueue::Entry &entry) {
    if (!removed && entry.status == ScanQueue::Status::Pending) {
      removed = true;
      return false;
    }
    return true;
  });
  if (removed) {
    dropped++;
    Health::countError(Err::QueueFull);
    LOG_W("queue", Err::QueueFull, "full; dropped the oldest scan (%u dropped in total)", dropped);
  }
}

}  // namespace

namespace ScanQueue {

bool begin() {
  const uint32_t started = millis();

  // Formatting a fresh 8MB partition takes a while, and the watchdog is
  // already running by now -- so this is the one place that must be fed from
  // outside the main loop.
  Watchdog::feed();
  mounted = LittleFS.begin(true, "/littlefs", 10, "littlefs");
  Watchdog::feed();

  if (!mounted) {
    // Not fatal. Scans still reach the server while it is up; what is lost is
    // the ability to hold them while it is not, and that is worth reporting
    // rather than failing the boot over.
    LOG_E("queue", Err::StorageFailure, "filesystem will not mount; scans will not survive a reboot");
    Health::countError(Err::StorageFailure);
    return false;
  }

  if (millis() - started > 2000) {
    LOG_I("queue", "filesystem took %ums to mount (first boot formats it)", millis() - started);
  }

  recount();
  if (pendingCount > 0 || failedEntries > 0) {
    LOG_I("queue", "%u scans waiting, %u given up on", pendingCount, failedEntries);
  }
  return true;
}

bool push(const Entry &entry) {
  if (!mounted) return false;

  if (pendingCount >= QUEUE_MAX_ENTRIES) dropOldest();

  File file = LittleFS.open(QUEUE_FILE, "a");
  if (!file) {
    LOG_E("queue", Err::StorageFailure, "could not append a scan");
    Health::countError(Err::StorageFailure);
    return false;
  }

  writeEntry(file, entry);
  file.close();
  pendingCount++;
  return true;
}

size_t peek(Entry *out, size_t max) {
  if (!mounted) return 0;

  File file = LittleFS.open(QUEUE_FILE, "r");
  if (!file) return 0;

  size_t found = 0;
  while (file.available() && found < max) {
    const String line = file.readStringUntil('\n');
    if (line.length() == 0) continue;

    Entry entry;
    if (!readEntry(line, entry)) continue;
    if (entry.status != Status::Pending) continue;  // do not keep offering the dead

    out[found++] = entry;
  }
  file.close();
  return found;
}

void removeConfirmed(const String *scanIds, size_t count) {
  if (!mounted || count == 0) return;
  rewrite([&](const Entry &entry) { return !contains(scanIds, count, entry.scanId); });
}

void recordFailure(const String *scanIds, size_t count) {
  if (!mounted || count == 0) return;

  uint16_t justFailed = 0;
  rewrite([&](Entry &entry) {
    if (!contains(scanIds, count, entry.scanId)) return true;

    entry.retries++;
    entry.lastAttempt = millis();
    if (entry.retries >= QUEUE_MAX_RETRIES && entry.status == Status::Pending) {
      entry.status = Status::Failed;
      justFailed++;
    }
    return true;
  });

  if (justFailed > 0) {
    // Kept rather than deleted: the count is a symptom worth seeing from the
    // server, and the barcodes may explain what the server keeps refusing.
    LOG_W("queue", Err::QueuePoisoned, "%u scan(s) refused %u times; no longer retrying",
          justFailed, QUEUE_MAX_RETRIES);
    Health::countError(Err::QueuePoisoned);
  }
}

size_t size() { return pendingCount; }
size_t failedCount() { return failedEntries; }
bool isEmpty() { return pendingCount == 0; }
uint32_t droppedCount() { return dropped; }

void clear() {
  if (!mounted) return;
  LittleFS.remove(QUEUE_FILE);
  pendingCount = 0;
  failedEntries = 0;
}

}  // namespace ScanQueue

/**
 * OtaPolicy decides when an offered update installs by itself. The cases that
 * matter most are the ones that would hurt on a real counter: an update that
 * interrupts someone scanning, a version compared as text ("1.10" < "1.9"),
 * an offer that points somewhere other than our firmware route, and the loop
 * where a board keeps reinstalling the version it just rolled back from.
 *
 *   ./run-tests.sh
 */
#include <cstdio>
#include <string>

#include "ota/OtaPolicy.h"
#include "platform/config.h"

using OtaPolicy::Moment;
using OtaPolicy::Scheduler;

namespace {

int failures = 0;

void check(bool condition, const std::string &what) {
  if (condition) return;
  std::printf("  FAIL  %s\n", what.c_str());
  failures++;
}

const char *kHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const char *kPath = "/api/v1/firmware/8d3c2c0e-4b1a-4c55-9a51-0d6c1f6a2b77.bin";

// A board that is idle, online and healthy: the moment an update should go.
Moment quiet(uint32_t now = 600000) {
  Moment m;
  m.now = now;
  m.online = true;
  m.freeHeap = 110000;
  return m;
}

void versions() {
  uint32_t code = 0;
  check(OtaPolicy::versionCode("1.2.3", code) && code == 1002003, "1.2.3 parses");
  check(OtaPolicy::versionCode("0.0.0", code) && code == 0, "0.0.0 parses");
  check(OtaPolicy::versionCode("999.999.999", code), "three digits per part");
  check(!OtaPolicy::versionCode("1.2", code), "two parts is not a version");
  check(!OtaPolicy::versionCode("1.2.3.4", code), "four parts is not a version");
  check(!OtaPolicy::versionCode("1..3", code), "empty part");
  check(!OtaPolicy::versionCode("1.2.3-beta", code), "suffix");
  check(!OtaPolicy::versionCode("1.2.1000", code), "four digits in a part");
  check(!OtaPolicy::versionCode("", code), "empty");
  check(!OtaPolicy::versionCode(nullptr, code), "null");

  check(OtaPolicy::isNewer("1.10.0", "1.9.0"), "1.10 is newer than 1.9 (numbers, not text)");
  check(OtaPolicy::isNewer("1.3.0", "1.2.9"), "minor beats patch");
  check(!OtaPolicy::isNewer("1.2.0", "1.2.0"), "same is not newer");
  check(!OtaPolicy::isNewer("1.1.9", "1.2.0"), "older is not newer");
  check(!OtaPolicy::isNewer("2.0.0", "garbage"), "unparseable current: never newer");
  check(!OtaPolicy::isNewer("garbage", "1.0.0"), "unparseable candidate: never newer");
}

void offers() {
  Scheduler s;
  check(s.offer("1.3.0", kPath, 1600000, kHash), "a good offer is kept");
  check(s.hasOffer() && s.wanted("1.2.0"), "newer offer is wanted");
  check(!s.wanted("1.3.0"), "not wanted when already running it");
  check(!s.wanted("1.4.0"), "never a downgrade");

  Scheduler bad;
  check(!bad.offer("1.3", kPath, 1, kHash), "bad version refused");
  check(!bad.offer("1.3.0", "https://evil.example/fw.bin", 1, kHash), "absolute url refused");
  check(!bad.offer("1.3.0", "/api/v1/firmware/../devices/x", 1, kHash), "traversal refused");
  check(!bad.offer("1.3.0", "/api/v1/firmware/a.bin?x=1", 1, kHash), "query string refused");
  check(!bad.offer("1.3.0", "/api/v1/other/a.bin", 1, kHash), "other route refused");
  check(!bad.offer("1.3.0", kPath, 1, "ABCDEF"), "short hash refused");
  check(!bad.offer("1.3.0", kPath, 1,
                   "0123456789ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef"),
        "uppercase hash refused (the server sends lowercase)");
  check(!bad.offer("1.3.0", kPath, 0, kHash), "zero size refused");
  check(!bad.offer("1.3.0", kPath, OTA_SLOT_BYTES + 1, kHash), "bigger than a slot refused");
  check(!bad.hasOffer(), "nothing kept from bad offers");

  // A bad offer also drops a good one held before it: the server's latest
  // word is the one that counts.
  s.offer("1.3.0", "nonsense", 1, kHash);
  check(!s.hasOffer(), "a malformed offer clears the previous one");
}

void timing() {
  Scheduler s;
  s.offer("1.3.0", kPath, 1600000, kHash);

  check(s.due(quiet(), "1.2.0"), "idle and online: install");

  Moment m = quiet();
  m.online = false;
  check(!s.due(m, "1.2.0"), "not while offline");

  m = quiet();
  m.onProbation = true;
  check(!s.due(m, "1.2.0"), "not while the running image is on probation");

  m = quiet();
  m.busy = true;
  check(!s.due(m, "1.2.0"), "not while pairing a scanner");

  m = quiet();
  m.queueEmpty = false;
  check(!s.due(m, "1.2.0"), "not while scans wait to upload");

  m = quiet();
  m.powerOk = false;
  check(!s.due(m, "1.2.0"), "not on battery");

  m = quiet();
  m.freeHeap = HEAP_CRITICAL_BYTES - 1;
  check(!s.due(m, "1.2.0"), "not when memory is already critical");

  m = quiet(1000000);
  m.scannedSinceBoot = true;
  m.lastScanAt = 1000000 - 30000;
  check(!s.due(m, "1.2.0"), "not 30s after a scan");
  m.lastScanAt = 1000000 - OTA_QUIET_AFTER_SCAN_MS;
  check(s.due(m, "1.2.0"), "fine once the quiet period has passed");

  // Across the 49-day millis() wrap: a scan just before the wrap, now just after.
  m = quiet(5000);
  m.scannedSinceBoot = true;
  m.lastScanAt = 0xFFFFFFFFu - 10000;
  check(!s.due(m, "1.2.0"), "a scan 15s ago across the wrap still counts as recent");
}

void backoff() {
  Scheduler s;
  s.offer("1.3.0", kPath, 1600000, kHash);
  const uint32_t t = 1000000;

  s.failed(t);
  check(!s.due(quiet(t + OTA_RETRY_FIRST_MS - 1), "1.2.0"), "first failure: wait");
  check(s.due(quiet(t + OTA_RETRY_FIRST_MS), "1.2.0"), "first failure: retry after the wait");

  s.failed(t);
  check(!s.due(quiet(t + OTA_RETRY_SECOND_MS - 1), "1.2.0"), "second failure: longer wait");
  check(s.due(quiet(t + OTA_RETRY_SECOND_MS), "1.2.0"), "second failure: then retry");

  s.failed(t);
  check(!s.due(quiet(t + OTA_RETRY_SECOND_MS), "1.2.0"), "third failure: hours, not minutes");
  check(s.due(quiet(t + OTA_RETRY_LONG_MS), "1.2.0"), "third failure: retry after the long wait");

  // The same offer again (every heartbeat repeats it) keeps the backoff...
  s.offer("1.3.0", kPath, 1600000, kHash);
  check(s.failures() == 3, "repeating the same offer keeps the backoff");
  // ...a new version starts fresh.
  s.offer("1.3.1", kPath, 1600000, kHash);
  check(s.failures() == 0 && s.due(quiet(t + 1), "1.2.0"), "a new version starts fresh");
}

void rejection() {
  Scheduler s;
  s.reject("1.3.0");
  s.offer("1.3.0", kPath, 1600000, kHash);
  check(!s.wanted("1.2.0"), "a rejected version is never wanted");
  check(!s.due(quiet(), "1.2.0"), "a rejected version is never installed");

  s.offer("1.3.1", kPath, 1600000, kHash);
  check(s.due(quiet(), "1.2.0"), "a later version is fine");

  s.reject(nullptr);
  s.offer("1.3.0", kPath, 1600000, kHash);
  check(s.due(quiet(), "1.2.0"), "clearing the rejection allows it again");
}

}  // namespace

int main() {
  versions();
  offers();
  timing();
  backoff();
  rejection();
  if (failures == 0) std::printf("ota policy: all passed\n");
  return failures == 0 ? 0 : 1;
}

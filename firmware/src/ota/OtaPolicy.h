#pragma once
#include <cstddef>
#include <cstdint>

/**
 * When an update the server offers actually gets installed.
 *
 * The server says *what* (a newer signed image for this build and board); this
 * decides *when*. Pure logic -- no radio, no flash, no clock of its own; the
 * caller passes `now` -- so every rule below is exercised on the host by
 * test/test_otapolicy.cpp rather than discovered on a kitchen counter.
 *
 * The rules, and why:
 *
 *   newer only        never sideways or back; a version that does not parse
 *                     is never "newer" -- no installing on a guess
 *   never a rejected  a version this board installed and then rolled back
 *   one               from is dead to it. Without this the board downloads,
 *                     fails, rolls back and downloads again, forever
 *   quiet             no scan for a couple of minutes, no scanner pairing, no
 *                     scans waiting to upload. An update is a minute of the
 *                     device not scanning; that minute should be one nobody
 *                     is using
 *   proven            not while the running image is itself on probation:
 *                     chaining unproven images loses the only good copy
 *   power             a hook for the battery device, which updates only while
 *                     charging. Always true on mains
 *   backoff           a failed attempt waits 2 min, then 10, then 6 hours, so
 *                     a broken download cannot keep the radio busy all day
 */
namespace OtaPolicy {

/** "major.minor.patch", each part 0-999 and nothing else. 1.2.10 -> 1002010. */
bool versionCode(const char *text, uint32_t &codeOut);

/** Strictly newer. False when either side does not parse. */
bool isNewer(const char *candidate, const char *current);

/** What the device is doing right now, as far as installing is concerned. */
struct Moment {
  uint32_t now = 0;
  bool online = false;       // Ready, WiFi up, talking to the server
  bool onProbation = false;  // the running image has not proved itself yet
  bool busy = false;         // pairing a scanner, or similar
  bool queueEmpty = true;    // scans waiting to upload go first
  bool scannedSinceBoot = false;
  uint32_t lastScanAt = 0;   // millis() of the last barcode, if any
  bool powerOk = true;       // mains, or a battery device that is charging
  uint32_t freeHeap = 0;
};

struct Offer {
  char version[17] = {};
  char path[96] = {};
  char sha256[65] = {};
  uint32_t size = 0;
};

class Scheduler {
 public:
  /**
   * Records the server's offer. A malformed one -- a version that does not
   * parse, a path outside the firmware route, a hash that is not 64 hex digits,
   * a size that would not fit a slot -- is refused and clears any offer held.
   * The same offer again keeps its backoff; a different one starts fresh.
   */
  bool offer(const char *version, const char *path, uint32_t size, const char *sha256);
  /** The server stopped offering anything (or offered nothing new). */
  void withdraw();

  /** A version this board rolled back from. It is never installed again. */
  void reject(const char *version);
  const char *rejected() const { return rejected_; }

  bool hasOffer() const { return offer_.version[0] != '\0'; }
  const Offer &current() const { return offer_; }

  /** An offer worth installing is held: newer than `running`, not rejected. */
  bool wanted(const char *running) const;
  /** Install now? */
  bool due(const Moment &m, const char *running) const;
  /** An attempt came back, which means it failed. */
  void failed(uint32_t now);
  uint8_t failures() const { return failures_; }

 private:
  Offer offer_;
  char rejected_[17] = {};
  uint8_t failures_ = 0;
  uint32_t retryAt_ = 0;
};

}  // namespace OtaPolicy

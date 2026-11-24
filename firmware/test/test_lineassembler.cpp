/**
 * LineAssembler is how a Bluetooth LE scanner's notifications, and a serial
 * module's bytes, become barcodes. The cases below are the shapes those
 * streams actually take -- one notification per scan, a long code split across
 * several, CR+LF, no terminator at all -- plus the failure that matters most:
 * an overlong line must never come out as a shorter, different barcode.
 *
 *   ./run-tests.sh
 */
#include <cstdio>
#include <string>

#include "scan/LineAssembler.h"

namespace {

int failures = 0;

void check(bool condition, const std::string &what) {
  if (condition) return;
  std::printf("  FAIL  %s\n", what.c_str());
  failures++;
}

// Feeds a chunk the way one BLE notification arrives. Returns every line it
// completed, joined with '|', so a test can see exactly what came out.
std::string feed(LineAssembler &a, const std::string &chunk, uint32_t now = 0) {
  std::string out;
  for (char c : chunk) {
    if (a.push(c, now)) {
      if (!out.empty()) out += '|';
      out += a.take();
    }
  }
  return out;
}

void oneNotificationPerScan() {
  // Exactly what the HBA-W7 sent in BLE mode: 13 digits and a CR.
  LineAssembler a;
  check(feed(a, "7290107954976\r") == "7290107954976", "EAN-13 + CR, as measured on the board");
  check(feed(a, "7290107954976\r") == "7290107954976", "the same code again is a second line");
  check(!a.pending(), "nothing left over after a clean line");
}

void terminators() {
  LineAssembler a;
  check(feed(a, "4006381\n") == "4006381", "LF alone");
  check(feed(a, "4006381\r\n") == "4006381", "CR+LF is one line, not a line and an empty one");
  check(feed(a, "\r\n\r\n") == "", "bare terminators produce nothing");
}

void splitAcrossNotifications() {
  // A QR code longer than the BLE MTU arrives in pieces.
  LineAssembler a;
  check(feed(a, "ABC-123") == "", "first half: nothing yet");
  check(a.pending(), "and it is held");
  check(feed(a, "/456\r") == "ABC-123/456", "second half completes it");
}

void twoScansInOneChunk() {
  LineAssembler a;
  check(feed(a, "1111\r2222\r") == "1111|2222", "two lines in one chunk both come out");
}

void noise() {
  LineAssembler a;
  check(feed(a, std::string("72\x01" "90\x7f" "00\r")) == "729000", "control bytes are skipped");
}

void overlongIsDroppedWhole() {
  LineAssembler a(8);
  check(feed(a, "123456789012\r") == "", "a line past the limit is not cut short");
  check(!a.pending(), "and leaves nothing behind");
  check(feed(a, "12345678\r") == "12345678", "exactly at the limit is fine");
  check(feed(a, "1234\r") == "1234", "the next line after an overflow is unaffected");
}

void noTerminatorFlushesWhenIdle() {
  // A scanner set to "No terminator" on its setup sheet.
  LineAssembler a;
  check(feed(a, "7290000000003", 1000) == "", "no terminator: nothing yet");
  check(!a.flushIfIdle(1100, 300), "not idle long enough");
  check(a.flushIfIdle(1300, 300), "idle long enough: it is a line");
  check(a.take() == "7290000000003", "and it is the whole code");
  check(!a.flushIfIdle(5000, 300), "nothing to flush afterwards");
}

void resetClears() {
  LineAssembler a;
  feed(a, "123");
  a.reset();
  check(!a.pending(), "reset drops a half line (a dropped connection)");
  check(feed(a, "456\r") == "456", "and the next line starts clean");
}

}  // namespace

int main() {
  oneNotificationPerScan();
  terminators();
  splitAcrossNotifications();
  twoScansInOneChunk();
  noise();
  overlongIsDroppedWhole();
  noTerminatorFlushesWhenIdle();
  resetClears();

  std::printf("LineAssembler\n  %s\n", failures == 0 ? "all checks passed" : "FAILED");
  return failures == 0 ? 0 : 1;
}

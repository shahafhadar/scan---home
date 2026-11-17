/**
 * Everything that arrives from outside the firmware passes through Validate,
 * and all of it is pure logic -- so it is checked here rather than by plugging
 * things into a board and hoping.
 *
 * The URL cases are the ones that matter. A firmware update is installed on the
 * strength of that check, and the difference between `startsWith` and a real
 * host comparison is the difference between a device that only takes our
 * firmware and one that takes anybody's.
 *
 *   ./run-tests.sh
 */
#include <cassert>
#include <cstdio>
#include <string>

#include "platform/Validate.h"
#include "platform/config.h"

namespace {

int failures = 0;

void check(bool condition, const std::string &what) {
  if (condition) return;
  std::printf("  FAIL  %s\n", what.c_str());
  failures++;
}

void barcodes() {
  check(Validate::barcode("7290000000003"), "a plain EAN-13");
  check(Validate::barcode("4006381"), "an EAN-8");
  check(Validate::barcode("ABC-123/4"), "code 128 with the symbols it allows");

  check(!Validate::barcode(""), "nothing at all");
  check(!Validate::barcode("12"), "too short to be a product");
  check(!Validate::barcode(std::string(64, '1')), "longer than any grocery barcode");
  check(!Validate::barcode("ABCDEFGH"), "letters only -- a scanner in the wrong mode");
  check(!Validate::barcode("729000\n0003"), "a newline in the middle");
  check(!Validate::barcode("7290\x01\x02 0003"), "control characters from a stuck modifier");
  check(!Validate::barcode("729000<script>"), "anything that is not barcode alphabet");
}

void urls() {
  // Written against the host this firmware was actually built for, so the test
  // says something true whichever host that is.
  const String host = SCANCART_HOST;

  check(Validate::urlUnderHost(host + "/firmware/1.0.0/firmware.bin"), "our own host");
  check(Validate::urlUnderHost(host), "the host on its own");

  // The reason this function exists instead of a startsWith call.
  check(!Validate::urlUnderHost(host + ".evil.example/firmware.bin"),
        "a hostname that merely begins with ours");
  check(!Validate::urlUnderHost(host + "@evil.example/firmware.bin"),
        "our host smuggled in as userinfo");
  check(!Validate::urlUnderHost("http://evil.example/firmware.bin"), "somewhere else entirely");
  check(!Validate::urlUnderHost(host + "/../../etc/passwd"), "path traversal");
  check(!Validate::urlUnderHost(host + "/firmware\n/x"), "a newline in the url");
  check(!Validate::urlUnderHost(""), "nothing at all");
}

void credentials() {
  check(Validate::ssid("Noa"), "an ordinary network name");
  check(Validate::ssid(std::string(32, 'a')), "the longest an ssid may be");
  check(!Validate::ssid(""), "no network name");
  check(!Validate::ssid(std::string(33, 'a')), "longer than an ssid may be");
  check(!Validate::ssid("bad\nname"), "a newline in the network name");

  check(Validate::wifiPassword(""), "an open network");
  check(Validate::wifiPassword("12345678"), "the shortest wpa2 passphrase");
  check(!Validate::wifiPassword("short"), "too short for wpa2 -- would never connect");
  check(!Validate::wifiPassword(std::string(64, 'a')), "too long for wpa2");
}

void versions() {
  check(Validate::version("1.0.0"), "a plain version");
  check(!Validate::version("1.0.0-rc1"), "anything but digits and dots");
  check(!Validate::version(""), "no version");
}

}  // namespace

int main() {
  std::printf("Validate\n");
  barcodes();
  urls();
  credentials();
  versions();

  if (failures == 0) {
    std::printf("  all checks passed\n");
    return 0;
  }
  std::printf("  %d check(s) failed\n", failures);
  return 1;
}

#pragma once
#include <stdint.h>

/**
 * What this board can prove about itself at boot, in well under a second.
 *
 * Not a factory test -- that needs a person and is a separate build. This is
 * the set of checks that cost nothing and turn a vague fault into a named one:
 * a board with the wrong flash size, a filesystem that will not mount, a
 * signing key that will not parse. Each of those produces symptoms far away
 * from its cause, hours later, and each is a single line to check here.
 *
 * Nothing here stops the boot. A device that reaches the network with one
 * broken subsystem can be repaired remotely; one that refuses to start cannot.
 */
namespace SelfTest {

enum Check : uint16_t {
  Nvs        = 1 << 0,  // settings survive a power cycle
  Filesystem = 1 << 1,  // the offline queue has somewhere to live
  FlashSize  = 1 << 2,  // the chip matches the partition table
  SigningKey = 1 << 3,  // updates will be installable
  Identity   = 1 << 4,  // this device knows who it is
};

// Deliberately not a check: this board has 8MB of PSRAM and the build does not
// enable it. The firmware uses 22% of the 320KB it already has, so switching
// on octal PSRAM would change the boot path for no benefit today. Reported by
// Diagnostics as information; see the README before turning it on.
//
// A self-test that fails on every healthy board is worse than none, because
// people learn to ignore it.

/** Runs every check and logs the failures. Call once, after storage is up. */
void run();

/** Bitmask of checks that passed. Reported in the heartbeat. */
uint16_t passed();

/** True if everything passed. */
bool allPassed();

/** "nvs,fs,flash" -- the names of what failed, for a log line or the server. */
const char *failureNames();

}  // namespace SelfTest

#pragma once
#include <stdint.h>

/**
 * What stops a bad update from turning a device into a paperweight.
 *
 * A crash during startup restarts the device, which crashes again. Without
 * this, that loop ends only when someone brings a cable -- and the whole point
 * of remote updates is that nobody has to.
 *
 * So: count boots that never reached a healthy state. After enough of them,
 * come up with almost nothing running. Safe mode does not scan and does not
 * queue; it joins WiFi, reports in, and accepts an update. That is the minimum
 * needed to fix the device from somewhere else, and the less it starts, the
 * better the odds it starts at all.
 */
namespace SafeMode {

/** Reads the counter and decides. Call early, before anything heavy. */
void begin();

bool active();

/**
 * "This boot got far enough to trust." Clears the counter.
 *
 * Deliberately not called at the end of setup() -- reaching the end of setup
 * proves very little. It is called once the device has been running for a
 * while and has actually talked to the server, which is the real bar.
 */
void markHealthy();

uint8_t failedBoots();

/**
 * "The restart about to happen is one we asked for."
 *
 * Without this, an update counts as a failed boot: the device restarts long
 * before it has been up two minutes, the counter survives, and five updates in
 * a row put a perfectly healthy device into safe mode. The counter is meant to
 * measure crashes, not intent.
 */
void expectRestart();

}  // namespace SafeMode

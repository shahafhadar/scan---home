#pragma once
#include <stdint.h>

/**
 * The last line of defence against a silent hang.
 *
 * Everything else in this firmware tries to recover in place -- reconnect the
 * radio, restart the USB host, retry the request. This exists for the case
 * none of that reaches: a loop wedged inside a driver, a socket that never
 * returns, a deadlock. If the main loop stops calling feed(), the chip
 * restarts itself and the reset reason records why.
 *
 * The timeout is deliberately generous. A watchdog that fires during a slow
 * but legitimate operation trains everyone to disable it.
 */
namespace Watchdog {

void begin(uint32_t timeoutSeconds);

/**
 * Called from the top of the main loop, and from inside any wait that can
 * legitimately run long.
 *
 * Not from inside a retry loop that could spin forever -- feeding there is
 * how a watchdog gets quietly neutered, because the very hang it exists to
 * catch keeps it satisfied.
 */
void feed();

/** Stop feeding on purpose, so the chip resets. Used by recovery paths. */
void forceReset(const char *reason);

bool enabled();

}  // namespace Watchdog

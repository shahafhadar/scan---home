#pragma once
#include <stdint.h>

#include "platform/ErrorCodes.h"

/**
 * The numbers that reveal a problem before it becomes a failure.
 *
 * A memory leak does not announce itself: the device works for five weeks and
 * then starts restarting, and by then nobody remembers what changed. What it
 * does do, from the first day, is push the minimum free heap down a little
 * each day. That is visible from here and nowhere else.
 */
namespace Health {

void begin();

/** Cheap; call it every loop. Samples heap on its own schedule. */
void tick();

void countError(Err error);
void countWifiReconnect();
void countUsbRestart();
void markServerSync();

/**
 * Takes the leak baseline: free heap once the radios and the TLS stack have
 * taken their share. Call once the device has settled (it is idempotent).
 * Until then only the absolute floor and fragmentation are judged.
 */
void settled();

uint32_t freeHeap();
uint32_t minFreeHeap();      // the lowest ever seen -- the leak indicator
uint32_t largestFreeBlock(); // fragmentation: can fall while freeHeap looks fine
uint32_t errorCount(Err error);
uint32_t totalErrors();
uint32_t wifiReconnects();
uint32_t usbRestarts();
uint32_t secondsSinceServerSync();

/** True when memory has dropped far enough to be worth reporting. */
bool memoryLooksUnhealthy();

}  // namespace Health

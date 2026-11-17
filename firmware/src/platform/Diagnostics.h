#pragma once
#include <Arduino.h>

/**
 * Everything about this device, in one JSON document, on request.
 *
 * The heartbeat carries what is worth sending every minute. This carries what
 * is worth having when something is actually wrong and the device is in
 * someone's kitchen: partition layout, network details, storage figures, the
 * self-test result, the full error breakdown, and the tuning constants this
 * build was compiled with.
 *
 * That last one matters more than it sounds. "The queue holds 500" is a fact
 * about the build in front of you, not about the fleet, and diagnosing a
 * device against the wrong constants wastes an afternoon.
 */
namespace Diagnostics {

/** Builds the snapshot. Costs a few milliseconds and some stack, not heap. */
String snapshot();

}  // namespace Diagnostics

#pragma once
#include <Arduino.h>

/**
 * Why did this device just start?
 *
 * Every restart in the field is a question, and without this there is no way
 * to answer it: a device that reboots nightly at 3am looks identical to one
 * someone unplugged, and a brownout looks identical to a crash. The reason is
 * read once at boot, kept, and reported in the heartbeat.
 */
namespace BootInfo {

void begin();

/** "POWERON", "PANIC", "TASK_WDT", "BROWNOUT", "SW", ... */
const char *resetReason();

/** True when the last restart was a fault rather than a normal power-up. */
bool lastResetWasFault();

/** How many times we have booted, ever. Survives everything but a chip erase. */
uint32_t bootCount();

/** Seconds since this boot. */
uint32_t uptimeSeconds();

}  // namespace BootInfo

#pragma once
#include <Arduino.h>

/**
 * Where the energy goes, measured rather than guessed.
 *
 * There is no current meter on this board, so this measures what decides the
 * current instead, and prints one line every POWER_REPORT_INTERVAL_MS:
 *
 *   [power] 300s | cpu0 7% cpu1 100% | https 6x 3.9s | ble wait 96% listen 50% | heap 116K min 39K block 43K
 *
 *   cpuN     how much of the window each core was busy (FreeRTOS run-time
 *            stats: whatever the idle task did not get). A busy core cannot
 *            clock-gate; an idle one sits in WAITI and draws far less
 *   https    exchanges with the server and the time spent in them: the
 *            radio transmitting, and TLS keeping a core at full speed
 *   ble      share of the window spent waiting for the scanner, and how much
 *            of that time the radio actually listens (scan window/interval)
 *   heap     free now, the lowest it has been, and the largest single block
 *            -- what a TLS handshake needs in one piece
 *
 * The datasheet turns these into milliamps; the log only states facts.
 */
namespace Power {

/** Extra text for the line, from parts this module does not know about. */
using Probe = void (*)(char *out, size_t capacity);

void begin(Probe probe = nullptr);

/** Call from the main loop. Prints when a window closes. */
void tick();

/** One exchange with the server took this long. */
void noteRequest(uint32_t ms);

}  // namespace Power

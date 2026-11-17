#pragma once
#include <Arduino.h>

/**
 * The only way this product can talk to the person using it. There is no
 * screen, so the LED and the buzzer are the entire user interface.
 *
 * Everything here is non-blocking. A delay() in the feedback path would sit
 * between the trigger pull and the beep, which is exactly the thing that must
 * feel instant.
 */
namespace Feedback {

enum class State {
  Booting,        // white
  Provisioning,   // blue, breathing
  Connecting,     // blue
  WaitingToPair,  // purple, slow pulse
  Ready,          // green
  Queued,         // amber -- scans are being stored, not sent
  Error,          // red
  Updating,       // magenta
};

void begin();
void setState(State state);
void tick();

// Fired the instant a barcode is read, before the network is involved.
void beepAccepted();
// The item went on the list but we do not know what it is.
void beepUnknown();
// Stored locally because there is no connection.
void beepQueued();
void beepError();
void beepPaired();

}  // namespace Feedback

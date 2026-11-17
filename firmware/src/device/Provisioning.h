#pragma once
#include <Arduino.h>

/**
 * First-run setup: the device puts up its own WiFi network, the phone that
 * joins it is redirected to a setup page, and the person picks their home
 * network from a list.
 *
 * The page then stays with them. Joining the home network, reaching the
 * server and being paired all happen while the phone is still on the device's
 * own network, so every step is reported live instead of leaving the user
 * watching an LED and guessing. This is the part of the product most likely
 * to lose a customer, so it is the part that gets the most care.
 */
namespace Provisioning {

enum class Progress {
  WaitingForInput,  // the form is on screen
  Connecting,       // trying the home network
  WifiFailed,       // wrong password, or the network went away
  SyncingTime,      // NTP, without which nothing signed will be accepted
  Registering,      // announcing ourselves to the server
  ServerFailed,     // connected to WiFi, but the server is unreachable
  WaitingToPair,    // showing the code, waiting for someone to enter it
  Paired,           // done
};

bool hasCredentials();
void loadCredentials(String &ssid, String &password);
void saveCredentials(const String &ssid, const String &password);
void clearCredentials();

void startPortal();
void stopPortal();
bool portalRunning();

/** Services the portal. A no-op when it is not running, so the long waits
 *  elsewhere in the firmware can call it unconditionally. */
void tick();

/** True once, when the user submits the form. */
bool consumeSubmission(String &ssid, String &password);

/** The code the user copied out of the app, empty if they skipped it. */
const String &claimToken();

void setProgress(Progress progress, const String &detail = "");

}  // namespace Provisioning

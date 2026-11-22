#pragma once
#include <Arduino.h>

#include "data/ScanQueue.h"

/**
 * Everything this device says to the server.
 *
 * Requests are signed rather than bearing a token: the secret never crosses
 * the network, and a timestamp inside the signature means a captured request
 * cannot be replayed later.
 */
namespace Uplink {

struct ScanResult {
  bool delivered = false;   // reached the server and was accepted
  bool identified = false;  // the server knew what the product was
  bool held = false;        // accepted, but the device is not paired yet
  String name;
};

void begin();

/**
 * Announces the device. Idempotent.
 *
 * `claimToken` is the code the user read in the app and typed into the setup
 * page. When it is present the server binds this device to their household
 * immediately and `claimedOut` comes back true -- which is the whole point of
 * moving the code in this direction: nothing has to be handed back over a
 * network that is about to disappear.
 */
bool registerDevice(const String &claimToken, String &pairingCodeOut, bool &claimedOut);

bool checkClaimed(bool &claimedOut);

// Sends one scan. On any failure the caller queues it.
ScanResult sendScan(const ScanQueue::Entry &entry, bool fromQueue);

// Sends everything waiting and removes whatever the server confirms.
// Returns the number of scans accepted.
size_t flushQueue();

/**
 * Says we are alive and collects any command waiting for us.
 *
 * `scannerAttached` and `keysSeen` are carried so the state of the physical
 * scanner is visible from the server. The usb build has no console -- the
 * socket that would carry one is the socket the scanner is plugged into -- so
 * without this there is no way to tell an unplugged scanner from a silent one.
 *
 * `ackId`, when not empty, reports that a command we were handed earlier has
 * now run; the caller clears it only once this call returns true, so a lost
 * reply does not silently drop the acknowledgement. Commands that reboot the
 * board (reboot, factory_reset, reprovision) never reach this -- there is no
 * next heartbeat to carry the ack on.
 */
bool heartbeat(bool scannerAttached, uint32_t keysSeen, String &commandOut,
               const String &ackId = String(), bool ackFailed = false);

/** Posts a diagnostics snapshot. Only ever sent because the server asked. */
bool sendDiagnostics(const String &json);

}  // namespace Uplink

#pragma once
#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFiClient.h>

#include <memory>

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
 * A client for the host this image was built against: TLS checked against our
 * CA bundle, or plain only for a bring-up build pointed at a laptop.
 */
std::unique_ptr<WiFiClient> newClient();

/**
 * Adds the device's signature to a request: serial, timestamp, and an HMAC
 * over `timestamp.body`. `body` must be exactly the bytes that will be sent
 * -- empty for a GET.
 */
void sign(HTTPClient &http, const String &body);

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
 *
 * The reply may also carry an update offer, which goes straight to Ota; the
 * beat in turn reports this image's build and where updating stands.
 */
bool heartbeat(bool scannerAttached, uint32_t keysSeen, String &commandOut,
               const String &ackId = String(), bool ackFailed = false);

/** Posts a diagnostics snapshot. Only ever sent because the server asked. */
bool sendDiagnostics(const String &json);

}  // namespace Uplink

#pragma once
#include <Arduino.h>

#include "ota/OtaPolicy.h"

/**
 * Firmware updates, from offer to proven image.
 *
 * The board has two application slots. An update is written to the inactive
 * one and only becomes the boot target once it has been downloaded in full and
 * its signature checked against a key compiled into the running firmware. A
 * device on a kitchen counter cannot be recovered with a cable by the person
 * who owns it, so this is the one subsystem with no acceptable failure mode.
 *
 * How an update arrives: every heartbeat reply may carry an offer -- a newer
 * signed image for this build and board. OtaPolicy decides when it goes in (a
 * quiet moment, never during a scan); nobody has to press anything.
 *
 * Three separate protections, guarding three different things:
 *
 *   the hash        -- that the bytes are the ones the server offered
 *   the signature   -- that the image came from us, whoever served it
 *   the probation   -- that the image, whoever made it, actually works
 *
 * The last is why the image is not confirmed at boot. A new image boots in a
 * pending state; if it does not prove itself within the window, the device
 * reboots into the previous image, remembers the version as rejected, says so
 * in its heartbeat, and never installs that version again.
 */
namespace Ota {

/** Reads the running image's state and what the last update did. Early in setup(). */
void begin();

/** True while this image is on probation and has not yet proved itself. */
bool onProbation();

/** Records a successful exchange with the server. */
void noteServerContact();

/**
 * Confirms or abandons the running image, if it is on probation. Call from the
 * main loop; it does nothing until the window closes one way or the other.
 * Abandoning reboots the device into the previous image and does not return.
 */
void tick();

/** Where updating stands, for the heartbeat. */
struct Status {
  const char *state;  // idle | pending | downloading | probation | failed
  String target;      // the version being moved to, if any
  String rejected;    // a version this board rolled back from
  String error;       // why the last attempt failed, while state is failed
};
Status status();

/** The heartbeat's offer. Malformed offers are dropped (and logged). */
void offer(const char *version, const char *path, uint32_t size, const char *sha256);
void withdrawOffer();

/** Whether the offered update should be installed at this moment. */
bool updateDue(const OtaPolicy::Moment &moment);

/**
 * Downloads, checks and installs the offered update, then restarts into it.
 * Returns only on failure -- there is no success path that comes back -- and
 * the failure is recorded, backed off and reported in the next heartbeat.
 */
bool installOffered();

}  // namespace Ota

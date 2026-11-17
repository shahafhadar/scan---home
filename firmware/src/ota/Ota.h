#pragma once
#include <Arduino.h>

/**
 * Remote firmware updates.
 *
 * The board has two application slots. An update is written to the inactive
 * one and only becomes the boot target once it has been downloaded in full and
 * its signature checked against a key compiled into the running firmware. A
 * device on a kitchen counter cannot be recovered with a cable by the person
 * who owns it, so this is the one subsystem with no acceptable failure mode.
 *
 * Two separate protections, guarding two different things:
 *
 *   the signature  -- that the image came from us
 *   the validation window -- that the image, whoever made it, actually works
 *
 * The second is why `confirm()` is not called at boot. A new image boots in a
 * pending state; if it does not prove itself within the window, the device
 * reboots into the previous image and stays there. Firmware that starts fine
 * and dies four minutes later is the case this catches, and it is the common
 * one.
 */
namespace Ota {

/** Reads the running image's state. Call once, early in setup(). */
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

/**
 * Downloads, verifies and installs an update, then restarts. Returns only on
 * failure -- there is no success path that comes back.
 */
bool applyUpdate(const String &url, const String &expectedVersion);

}  // namespace Ota

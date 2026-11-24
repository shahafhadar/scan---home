#pragma once
#include <Arduino.h>

/**
 * Who this device is. Generated once on first boot and kept in NVS, which
 * survives reflashing the application but is wiped by a factory reset.
 *
 * For production these should be burned on the assembly line instead, so that
 * a device's identity exists before it ever reaches a network. See
 * docs/SECURITY.md.
 */
namespace DeviceIdentity {

void begin();

// Stable per-device, derived from the factory MAC: "SC-A1B2C3D4E5F6".
const String &serial();

// 64 hex characters. Never leaves the device; used only as an HMAC key.
const String &secretHash();

// Six characters, generated here on first boot rather than handed down by the
// server. That matters: the setup page is the only screen this product has,
// and it is shown before the device has ever reached the network. A code that
// only exists after registration cannot be printed on it.
const String &pairingCode();
void setPairingCode(const String &code);

bool isRegistered();
void setRegistered(bool value);

// Wipes everything, so the device can be given away or resold.
void factoryReset();

}  // namespace DeviceIdentity

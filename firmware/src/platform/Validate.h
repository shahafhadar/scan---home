#pragma once
#include <Arduino.h>

/**
 * Checks on everything that arrives from outside the firmware.
 *
 * Three sources feed this device and none of them are trustworthy by default:
 * a scanner that can emit anything a keyboard can, a setup form filled in by
 * a person, and a server that might be having a bad day or might not be our
 * server at all. Each is validated at the boundary it enters through, once,
 * so nothing downstream has to wonder.
 */
namespace Validate {

/**
 * A barcode. Digits and the handful of symbols real symbologies use, within a
 * plausible length. A HID scanner is a keyboard: a misread, a stuck modifier
 * or a device that is not a scanner at all can send control characters and
 * arbitrary text, and none of that belongs in a JSON body or a queue file.
 */
bool barcode(const String &value);

/** 1..32 characters, no control characters. Longer is not a valid SSID. */
bool ssid(const String &value);

/** WPA2 allows 8..63 for a passphrase; empty means an open network. */
bool wifiPassword(const String &value);

/**
 * A URL that really is under `SCANCART_HOST`.
 *
 * A plain prefix test is not enough, and the difference matters: with a host
 * of `https://api.example.com`, the string `https://api.example.com.evil.net/f`
 * passes `startsWith` and points somewhere else entirely. The character after
 * the host has to be a path separator or the end of the string.
 */
bool urlUnderHost(const String &url);

/** A semver-ish firmware version: digits and dots, nothing exotic. */
bool version(const String &value);

}  // namespace Validate

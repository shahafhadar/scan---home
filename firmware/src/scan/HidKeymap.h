#pragma once
#include <Arduino.h>

/**
 * USB HID keyboard usage IDs to characters.
 *
 * A barcode scanner in keyboard-wedge mode does not send text: it sends the
 * key presses a person would have made to type the barcode. So we have to
 * undo that, including the shift pairs, because Code 128 barcodes contain
 * letters and punctuation, not just digits.
 *
 * These are USB HID usage IDs (HID Usage Table, keyboard page 0x07). They are
 * NOT the Linux evdev codes -- an evdev table looks similar and is wrong here.
 */
namespace HidKeymap {

// Returns 0 for keys that produce no character (modifiers, function keys).
char toChar(uint8_t usage, bool shift);

// Enter, on either the main block or the keypad, terminates a barcode.
bool isEnter(uint8_t usage);

bool isShift(uint8_t modifier);

}  // namespace HidKeymap

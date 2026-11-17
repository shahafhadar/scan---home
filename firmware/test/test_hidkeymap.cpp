/**
 * The HID keymap is pure logic with no hardware in it, so it can be compiled
 * and run on a development machine. That matters: the usage IDs are easy to
 * get subtly wrong (an evdev table looks almost identical and is not), and a
 * wrong table means barcodes that decode into plausible but incorrect digits
 * -- the kind of fault that reaches a customer.
 *
 *   ./run-tests.sh
 */
#include <cassert>
#include <cstdio>
#include <string>

#include "scan/HidKeymap.h"

namespace {

int failures = 0;

void check(bool condition, const std::string &what) {
  if (!condition) {
    printf("  FAIL  %s\n", what.c_str());
    failures++;
  }
}

// Types a string the way a keyboard-wedge scanner would, and decodes it back.
std::string roundTrip(const std::string &text) {
  std::string out;
  for (char c : text) {
    uint8_t usage = 0;
    bool shift = false;

    if (c >= '1' && c <= '9') usage = 0x1E + (c - '1');
    else if (c == '0') usage = 0x27;
    else if (c >= 'a' && c <= 'z') usage = 0x04 + (c - 'a');
    else if (c >= 'A' && c <= 'Z') { usage = 0x04 + (c - 'A'); shift = true; }
    else if (c == '-') usage = 0x2D;
    else if (c == '.') usage = 0x37;
    else if (c == ' ') usage = 0x2C;
    else continue;

    const char decoded = HidKeymap::toChar(usage, shift);
    if (decoded) out += decoded;
  }
  return out;
}

}  // namespace

int main() {
  printf("HidKeymap\n");

  // A real Israeli barcode, digit for digit.
  check(roundTrip("7290000066318") == "7290000066318", "EAN-13 digits round trip");

  // Code 128 barcodes carry letters and mixed case.
  check(roundTrip("ABC-123-xyz") == "ABC-123-xyz", "alphanumeric with hyphens");
  check(roundTrip("LOT.2026") == "LOT.2026", "dot and uppercase");

  // Keypad digits: many scanners send these instead of the top row, and this
  // is where a mistaken table quietly drops half of every barcode.
  std::string keypad;
  for (uint8_t usage = 0x59; usage <= 0x61; usage++) keypad += HidKeymap::toChar(usage, false);
  keypad += HidKeymap::toChar(0x62, false);
  check(keypad == "1234567890", "keypad 1-9 then 0");

  // Shift must not change what a digit key on the keypad produces.
  check(HidKeymap::toChar(0x59, true) == '1', "shifted keypad 1 is still 1");

  // Shifted top-row digits are symbols, not digits.
  check(HidKeymap::toChar(0x1E, true) == '!', "shift+1 is !");
  check(HidKeymap::toChar(0x27, false) == '0', "0 is on usage 0x27, after 9");
  check(HidKeymap::toChar(0x27, true) == ')', "shift+0 is )");

  // Terminators.
  check(HidKeymap::isEnter(0x28), "Return terminates");
  check(HidKeymap::isEnter(0x58), "keypad Enter terminates");
  check(!HidKeymap::isEnter(0x2C), "space does not terminate");

  // Modifiers produce nothing rather than garbage.
  check(HidKeymap::toChar(0xE1, false) == 0, "left shift produces no character");
  check(HidKeymap::toChar(0x00, false) == 0, "empty slot produces no character");
  check(HidKeymap::toChar(0x3A, false) == 0, "F1 produces no character");

  check(HidKeymap::isShift(0x02), "left shift modifier detected");
  check(HidKeymap::isShift(0x20), "right shift modifier detected");
  check(!HidKeymap::isShift(0x01), "control is not shift");

  if (failures == 0) {
    printf("  all checks passed\n");
    return 0;
  }
  printf("  %d failed\n", failures);
  return 1;
}

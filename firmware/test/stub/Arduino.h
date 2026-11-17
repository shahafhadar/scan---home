#pragma once
// Just enough of Arduino.h for the hardware-independent parts of the firmware
// to compile on a development machine.
#include <cstdint>
#include <string>

/**
 * std::string with the two Arduino methods our pure-logic code uses. Wrapping
 * rather than replacing keeps the firmware written in Arduino's idiom -- the
 * host build exists to test that code, not a translation of it.
 */
struct String : std::string {
  using std::string::string;
  String() = default;
  String(const std::string &other) : std::string(other) {}

  bool startsWith(const String &prefix) const { return rfind(prefix, 0) == 0; }
  int indexOf(const char *needle) const {
    const auto at = find(needle);
    return at == npos ? -1 : static_cast<int>(at);
  }
  int indexOf(char needle) const {
    const auto at = find(needle);
    return at == npos ? -1 : static_cast<int>(at);
  }
};

#include "scan/HidKeymap.h"

namespace HidKeymap {

char toChar(uint8_t usage, bool shift) {
  // 0x04..0x1D: a-z
  if (usage >= 0x04 && usage <= 0x1D) {
    const char base = static_cast<char>('a' + (usage - 0x04));
    return shift ? static_cast<char>(base - 32) : base;
  }

  // 0x1E..0x27: 1234567890 along the top row, with their shifted symbols.
  if (usage >= 0x1E && usage <= 0x27) {
    static const char digits[] = "1234567890";
    static const char symbols[] = "!@#$%^&*()";
    const uint8_t index = usage - 0x1E;
    return shift ? symbols[index] : digits[index];
  }

  // 0x59..0x61: keypad 1-9, then 0x62 is keypad 0. Many scanners send the
  // keypad codes instead of the top row, and a scan that silently drops half
  // its digits is worse than one that fails outright.
  if (usage >= 0x59 && usage <= 0x61) return static_cast<char>('1' + (usage - 0x59));
  if (usage == 0x62) return '0';

  switch (usage) {
    case 0x2D: return shift ? '_' : '-';
    case 0x2E: return shift ? '+' : '=';
    case 0x2C: return ' ';
    case 0x36: return shift ? '<' : ',';
    case 0x37: return shift ? '>' : '.';
    case 0x38: return shift ? '?' : '/';
    case 0x56: return '-';  // keypad minus
    case 0x63: return '.';  // keypad dot
    default:   return 0;
  }
}

bool isEnter(uint8_t usage) {
  return usage == 0x28 || usage == 0x58;  // Return, keypad Enter
}

bool isShift(uint8_t modifier) {
  return (modifier & 0x02) || (modifier & 0x20);  // left shift, right shift
}

}  // namespace HidKeymap

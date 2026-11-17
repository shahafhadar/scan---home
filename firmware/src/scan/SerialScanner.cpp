#include "scan/SerialScanner.h"

#include "platform/Log.h"

namespace {
constexpr size_t kMaxBarcode = 64;
}  // namespace

void SerialScanner::begin() {
  buffer_.reserve(kMaxBarcode);
  LOG_I("scan", "bring-up mode: type a barcode and press enter");
}

bool SerialScanner::poll(String &barcode) {
  while (Serial.available()) {
    const char c = static_cast<char>(Serial.read());

    if (c == '\r' || c == '\n') {
      if (buffer_.length() == 0) continue;
      barcode = buffer_;
      buffer_ = "";
      return true;
    }

    if (c >= 0x20 && c < 0x7F) {
      if (buffer_.length() < kMaxBarcode) buffer_ += c;
    }
  }
  return false;
}

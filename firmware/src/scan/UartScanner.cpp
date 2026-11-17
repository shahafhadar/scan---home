#include "platform/config.h"
#include "scan/UartScanner.h"

namespace {
// Nothing legitimate is this long; a runaway line means noise on the wire.
constexpr size_t kMaxBarcode = 64;
}  // namespace

void UartScanner::begin() {
  Serial1.begin(SCANNER_BAUD, SERIAL_8N1, PIN_SCANNER_RX, PIN_SCANNER_TX);
  buffer_.reserve(kMaxBarcode);
}

bool UartScanner::poll(String &barcode) {
  while (Serial1.available()) {
    const char c = static_cast<char>(Serial1.read());

    if (c == '\r' || c == '\n') {
      if (buffer_.length() == 0) continue;  // trailing terminator
      barcode = buffer_;
      buffer_ = "";
      return true;
    }

    // Ignore anything that is not printable ASCII rather than passing line
    // noise upstream as if it were a product.
    if (c >= 0x20 && c < 0x7F) {
      if (buffer_.length() < kMaxBarcode) buffer_ += c;
    }
  }
  return false;
}

#include "scan/LineAssembler.h"

bool LineAssembler::push(char c, uint32_t nowMs) {
  lastByteAt_ = nowMs;

  if (c == '\r' || c == '\n') return complete();

  // Anything that is not printable ASCII is line noise or a binary frame, not
  // part of a barcode. Skipped rather than passed upstream as a product.
  if (c < 0x20 || c >= 0x7F) return false;

  if (overflow_) return false;  // already lost; wait for the terminator
  if (buffer_.length() >= max_) {
    overflow_ = true;
    buffer_ = "";
    return false;
  }
  buffer_ += c;
  return false;
}

bool LineAssembler::flushIfIdle(uint32_t nowMs, uint32_t idleMs) {
  if (!pending()) return false;
  if (nowMs - lastByteAt_ < idleMs) return false;
  return complete();
}

bool LineAssembler::complete() {
  if (overflow_) {
    // The tail of a line that was too long. Dropped whole, see the header.
    overflow_ = false;
    buffer_ = "";
    return false;
  }
  if (buffer_.length() == 0) return false;  // CR+LF, or a stray terminator
  complete_ = buffer_;
  buffer_ = "";
  return true;
}

String LineAssembler::take() {
  String line = complete_;
  complete_ = "";
  return line;
}

void LineAssembler::reset() {
  buffer_ = "";
  complete_ = "";
  overflow_ = false;
}

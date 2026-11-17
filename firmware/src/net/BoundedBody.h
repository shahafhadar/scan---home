#pragma once
#include <Arduino.h>
#include <cstddef>
#include <cstdint>

/**
 * Collects a response body up to a hard cap. Used for replies that arrive
 * without a Content-Length (chunked): the cap cannot be checked up front, so
 * it is enforced while the bytes come in, and the first byte past it is
 * refused rather than buffered.
 *
 * Pure logic, so the native tests cover it; the Stream adapter that hands it
 * to HTTPClient lives in Uplink.cpp.
 */
class BoundedBody {
 public:
  BoundedBody(String &out, size_t limit) : out_(out), limit_(limit) { out_ = ""; }

  /** Takes as much of `data` as fits. Returns how many bytes were taken. */
  size_t append(const uint8_t *data, size_t length) {
    const size_t room = limit_ - out_.length();
    const size_t take = length < room ? length : room;
    for (size_t i = 0; i < take; i++) out_ += static_cast<char>(data[i]);
    if (take < length) overflowed_ = true;
    return take;
  }

  bool overflowed() const { return overflowed_; }

 private:
  String &out_;
  const size_t limit_;
  bool overflowed_ = false;
};

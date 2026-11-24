#pragma once
#include <Arduino.h>

/**
 * Turns a stream of bytes into barcodes: printable ASCII up to a CR or LF.
 *
 * Every scanner that sends text rather than key presses needs exactly this --
 * a serial module on the UART pins, and a Bluetooth LE scanner, whose
 * notifications carry the barcode as text followed by the terminator chosen on
 * its setup sheet. Pure logic, so it is tested on the host.
 *
 * Two things it does on purpose:
 *
 *   - A line longer than the limit is dropped whole, not cut. A truncated
 *     barcode is a different, plausible-looking barcode, and the wrong product
 *     on someone's list is worse than a scan that has to be repeated.
 *   - A scanner set to "no terminator" never sends CR/LF. flushIfIdle() treats
 *     text that has sat unfinished for a moment as complete, so that setting
 *     degrades to slightly slower rather than to nothing at all.
 */
class LineAssembler {
 public:
  explicit LineAssembler(size_t maxLength = 64) : max_(maxLength) {}

  /** Feeds one byte. True when it completed a line; take() then returns it. */
  bool push(char c, uint32_t nowMs = 0);

  /**
   * True when unfinished text has had no new byte for idleMs; it becomes the
   * completed line. Call it from the poll loop.
   */
  bool flushIfIdle(uint32_t nowMs, uint32_t idleMs);

  /** The completed line, once. */
  String take();

  bool pending() const { return buffer_.length() > 0 || overflow_; }
  void reset();

 private:
  bool complete();

  size_t max_;
  String buffer_;
  String complete_;
  bool overflow_ = false;
  uint32_t lastByteAt_ = 0;
};

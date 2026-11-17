#pragma once
#include <Arduino.h>

/**
 * A source of barcodes. USB-HID and UART both look like this to the rest of
 * the firmware, which is what lets the hardware be brought up over UART and
 * switched to USB later without touching anything above this line.
 */
class ScanSource {
 public:
  virtual ~ScanSource() = default;
  virtual void begin() = 0;
  // Called every loop. Returns true exactly once per completed barcode.
  virtual bool poll(String &barcode) = 0;
  virtual const char *name() const = 0;

  // Whether a physical scanner is present, where that is knowable. Sources
  // that cannot tell -- a serial line, a typed barcode -- report true, since
  // for them the question does not arise.
  virtual bool attached() const { return true; }
  virtual uint32_t keysSeen() const { return 0; }

  // How many times this source had to be brought back up. Non-zero is a
  // hardware story -- a loose socket, a dongle browning out -- and it is worth
  // seeing from the server rather than only in a log nobody is reading.
  virtual uint32_t restarts() const { return 0; }
};

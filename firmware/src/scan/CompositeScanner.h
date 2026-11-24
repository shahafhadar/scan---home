#pragma once
#include "scan/ScanSource.h"

/**
 * Two scanners behind one ScanSource: the USB dongle and a Bluetooth LE
 * scanner, in the same firmware. Whichever is connected works; both at once
 * also works. The rest of the firmware -- the heartbeat, onBarcode -- sees one
 * scanner, attached when either is.
 *
 * Both are polled every pass, so each keeps doing its own housekeeping (the
 * USB host restart, the Bluetooth reconnect) even while the other is busy.
 */
class CompositeScanner : public ScanSource {
 public:
  CompositeScanner(ScanSource &first, ScanSource &second) : first_(first), second_(second) {}

  void begin() override {
    first_.begin();
    second_.begin();
  }

  bool poll(String &barcode) override {
    // A barcode from the first is returned now; the second still gets its
    // turn on the next pass, a few milliseconds later.
    if (first_.poll(barcode)) return true;
    return second_.poll(barcode);
  }

  const char *name() const override { return "usb-hid + ble"; }
  bool attached() const override { return first_.attached() || second_.attached(); }
  uint32_t keysSeen() const override { return first_.keysSeen() + second_.keysSeen(); }
  uint32_t restarts() const override { return first_.restarts() + second_.restarts(); }

 private:
  ScanSource &first_;
  ScanSource &second_;
};

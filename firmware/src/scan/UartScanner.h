#pragma once
#include "scan/ScanSource.h"

/**
 * Serial barcode modules (GM65 and friends) send the barcode as plain text
 * terminated by CR/LF. This is the simple path, and the one to bring up first.
 */
class UartScanner : public ScanSource {
 public:
  void begin() override;
  bool poll(String &barcode) override;
  const char *name() const override { return "uart"; }

 private:
  String buffer_;
};

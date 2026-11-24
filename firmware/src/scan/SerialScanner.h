#pragma once
#include "scan/ScanSource.h"

/**
 * A barcode typed into the serial monitor, treated exactly as a scanned one.
 *
 * This exists so the board can be brought up with no scanner attached at all.
 * It proves WiFi, NTP, TLS, the request signature, the server and the offline
 * queue on the real hardware -- everything except the USB stack. Once this
 * works, any failure under the USB build is unambiguously a USB problem, and
 * that is worth a great deal when the alternative is debugging two unknowns at
 * once.
 *
 *   pio run -e serial -t upload -t monitor
 *   then type: 7290000066318 <enter>
 */
class SerialScanner : public ScanSource {
 public:
  void begin() override;
  bool poll(String &barcode) override;
  const char *name() const override { return "serial (bring-up)"; }

 private:
  String buffer_;
};

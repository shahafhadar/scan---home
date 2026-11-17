#pragma once
#include "scan/ScanSource.h"

#if defined(SCANNER_USB_HID)
#include <EspUsbHost.h>

/**
 * A USB barcode scanner, or the dongle of a wireless one, enumerates as a
 * keyboard and "types" the barcode. We reassemble it here.
 *
 * Hardware note that costs a day if missed: the DevKitC-1 does not supply
 * VBUS on its USB-OTG port. The scanner gets no power unless 5V is wired to
 * it from the board's 5V pin, with a common ground.
 */
class UsbHidScanner : public ScanSource {
 public:
  void begin() override;
  bool poll(String &barcode) override;
  const char *name() const override { return "usb-hid"; }

  // Reported in the heartbeat. Without a serial console attached -- and the
  // usb target cannot have one, because the socket carrying it is the socket
  // the scanner occupies -- this is the only way to tell "no scanner plugged
  // in" apart from "scanner plugged in but saying nothing".
  bool attached() const override { return attached_; }
  uint32_t keysSeen() const override { return keys_; }
  uint32_t restarts() const override { return restarts_; }

 private:
  void onKey(const EspUsbHostKeyboardEvent &event);

  EspUsbHost host_;
  // Written from the host's own task, read from loop(). Short and guarded, so
  // a mutex would cost more than it protects.
  /**
   * Brings the host stack back up when no scanner has been seen for a while.
   *
   * The old code started the host once and, if that found nothing, waited
   * forever -- a dongle knocked out of its socket meant a device that looked
   * alive, reported in every minute, and silently scanned nothing until
   * somebody power-cycled it. Backs off so a genuinely empty socket is not
   * retried every half minute for weeks.
   */
  void restartHostIfMissing();

  volatile bool ready_ = false;
  volatile bool attached_ = false;
  volatile uint32_t keys_ = 0;
  uint32_t restarts_ = 0;
  uint32_t lastSeenAt_ = 0;
  uint32_t nextRestartAt_ = 0;
  uint32_t restartBackoffS_ = 0;
  String buffer_;
  String complete_;
};
#endif

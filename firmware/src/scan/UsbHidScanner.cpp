#include "scan/UsbHidScanner.h"

#if defined(SCANNER_USB_HID)
#include "platform/Health.h"
#include "platform/Log.h"
#include "platform/config.h"
#include "scan/HidKeymap.h"

namespace {
constexpr size_t kMaxBarcode = 64;
}  // namespace

void UsbHidScanner::begin() {
  buffer_.reserve(kMaxBarcode);
  host_.onKeyboard([this](const EspUsbHostKeyboardEvent &event) { onKey(event); });

  host_.onDeviceConnected([this](const EspUsbHostDeviceInfo &info) {
    attached_ = true;
    lastSeenAt_ = millis();
    restartBackoffS_ = 0;  // it came back; start over if it goes again
    LOG_I("usb", "attached: vid %04x pid %04x %s %s", info.vid, info.pid, info.manufacturer,
          info.product);
  });
  host_.onDeviceDisconnected([this](const EspUsbHostDeviceInfo &) {
    attached_ = false;
    LOG_W("usb", Err::ScannerLost, "scanner removed");
  });

  // A powered USB hub between the board and the dongle is how the dongle gets
  // real 5V (the board's own USB-OTG port does not supply VBUS -- see the
  // class comment). Devices behind a hub enumerate fine either way; tracking
  // the hub itself is not needed here and buys nothing for a plain HID
  // keyboard, while it is the documented path to a hub-driver crash with at
  // least one hub/device combination (EspUsbHost's
  // tests/manual/README.md, "Hub combinations that crash ESP-IDF"). Off by
  // default, before the first begin(), so a boot loop from that stays
  // reflashable rather than something we discover on this product.
  host_.setHubTrackingEnabled(false);

  lastSeenAt_ = millis();
  if (!host_.begin()) {
    LOG_E("usb", Err::ScannerLost, "host failed to start");
    return;
  }
  LOG_I("usb", "host up, waiting for a scanner");
}

void UsbHidScanner::onKey(const EspUsbHostKeyboardEvent &event) {
  // Only key presses. A scanner sends press and release for every character,
  // and counting both would double every digit in the barcode.
  if (!event.pressed) return;
  // Read-modify-write spelled out: `keys_++` on a volatile is deprecated in
  // C++20 and warned about on every build. Nothing subtle is intended here --
  // this counter is only ever written from the USB callback.
  keys_ = keys_ + 1;

  if (HidKeymap::isEnter(event.keycode)) {
    if (buffer_.length() > 0) {
      complete_ = buffer_;
      buffer_ = "";
      ready_ = true;
    }
    return;
  }

  // Our own table first, so decoding does not depend on whatever layout the
  // library defaults to -- a barcode must come back byte for byte. The
  // library's own ascii is the fallback for keys we do not map.
  char c = HidKeymap::toChar(event.keycode, HidKeymap::isShift(event.modifiers));
  if (c == 0 && event.ascii >= 0x20 && event.ascii < 0x7F) {
    c = static_cast<char>(event.ascii);
  }
  if (c != 0 && buffer_.length() < kMaxBarcode) buffer_ += c;
}

void UsbHidScanner::restartHostIfMissing() {
  if (attached_) {
    lastSeenAt_ = millis();
    return;
  }

  const uint32_t now = millis();
  if (now - lastSeenAt_ < SCANNER_MISSING_BEFORE_RESTART_MS) return;
  if (nextRestartAt_ != 0 && now < nextRestartAt_) return;

  restarts_++;
  Health::countUsbRestart();
  LOG_W("usb", Err::ScannerLost, "no scanner for %us, restarting the host (attempt %u)",
        (now - lastSeenAt_) / 1000, restarts_);

  host_.end();
  delay(50);  // the stack needs a moment to release the peripheral
  if (!host_.begin()) LOG_E("usb", Err::ScannerLost, "host restart failed");

  // Back off, so an empty socket is not retried every thirty seconds forever.
  restartBackoffS_ = restartBackoffS_ == 0
                         ? SCANNER_MISSING_BEFORE_RESTART_MS / 1000
                         : min<uint32_t>(restartBackoffS_ * 2, SCANNER_RESTART_MAX_BACKOFF_S);
  nextRestartAt_ = now + restartBackoffS_ * 1000UL;
  lastSeenAt_ = now;
}

bool UsbHidScanner::poll(String &barcode) {
  // The library runs the host stack on its own task, so there is nothing to
  // drive here -- we only collect what the callback has finished assembling,
  // and watch for a scanner that has gone away.
  restartHostIfMissing();

  if (!ready_) return false;
  barcode = complete_;
  complete_ = "";
  ready_ = false;
  return true;
}
#endif

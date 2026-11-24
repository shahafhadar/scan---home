#include "scan/BleScanner.h"

#if defined(SCANNER_BLE)
#include <Preferences.h>

#include "hmi/Feedback.h"
#include "platform/ErrorCodes.h"
#include "platform/Log.h"
#include "platform/config.h"

namespace {

// Measured with tools/blescan; see docs/hardware-setup.md.
const NimBLEUUID kAdvertService(static_cast<uint16_t>(0xAF30));
const NimBLEUUID kDataService(static_cast<uint16_t>(0xAE30));
const NimBLEUUID kBarcodeCharacteristic(static_cast<uint16_t>(0xAE02));
constexpr const char *kAdvertName = "BARCODE SCANNER";

constexpr const char *kPrefs = "scanner";
constexpr size_t kStreamBytes = 512;   // a few dozen barcodes of slack
constexpr uint32_t kIdleFlushMs = 300;  // "no terminator" scanners, see LineAssembler
constexpr uint32_t kRetryMs = 1000;     // after a failed subscribe, before re-arming
// The standing connection request is re-armed this often. The controller
// would wait forever; re-arming is only so a lost request cannot stay lost.
constexpr uint32_t kReconnectWindowMs = 30000;
// Pairing picks the nearest scanner, not the first: after the first one shows
// up, give a closer one this long to be heard too.
constexpr uint32_t kPickNearestMs = 1500;

// Connection parameters, in BLE units. 15-30ms interval: quick to subscribe
// and to deliver a barcode, without hogging the radio WiFi shares. 4s
// supervision timeout, so a burst of WiFi traffic is not mistaken for a lost
// link. While the request is pending the controller listens 10ms of every
// 20ms for the scanner's advert -- half the radio, the rest is WiFi's.
constexpr uint16_t kConnIntervalMin = 12;  // x1.25ms
constexpr uint16_t kConnIntervalMax = 24;
constexpr uint16_t kSupervisionTimeout = 400;  // x10ms
constexpr uint16_t kInitScanInterval = 32;     // x0.625ms
constexpr uint16_t kInitScanWindow = 16;

}  // namespace

// ---------------------------------------------------------------- NimBLE task

void BleScanner::ScanEvents::onResult(const NimBLEAdvertisedDevice *device) {
  BleScanner &o = owner_;
  if (o.phase_ != Phase::Pairing || !o.looksLikeOurKind(device)) return;

  portENTER_CRITICAL(&o.mux_);
  if (!o.candidateSeen_ || device->getRSSI() > o.candidateRssi_) {
    if (!o.candidateSeen_) o.candidateFirstAt_ = millis();
    o.candidate_ = device->getAddress();
    o.candidateRssi_ = device->getRSSI();
    o.candidateSeen_ = true;
  }
  portEXIT_CRITICAL(&o.mux_);
}

void BleScanner::ClientEvents::onConnect(NimBLEClient *) {
  owner_.linkUpAt_ = millis();
  owner_.linkUp_ = true;
}

void BleScanner::ClientEvents::onConnectFail(NimBLEClient *, int) { owner_.connectFailed_ = true; }

void BleScanner::ClientEvents::onDisconnect(NimBLEClient *, int reason) {
  owner_.disconnectReason_ = reason;
  owner_.connected_ = false;
  owner_.disconnected_ = true;
}

void BleScanner::onData(const uint8_t *data, size_t length) {
  bytes_ = bytes_ + length;
  // Never blocks: if the loop has fallen this far behind, losing bytes is
  // better than stalling the Bluetooth stack.
  if (stream_) xStreamBufferSend(stream_, data, length, 0);
}

// ---------------------------------------------------------------- main loop

void BleScanner::begin() {
  loadSaved();
  if (!stream_) stream_ = xStreamBufferCreate(kStreamBytes, 1);

  if (!stream_ || !NimBLEDevice::init("scan-home")) {
    LOG_E("ble", Err::ScannerLost, "bluetooth did not start; USB scanning still works");
    phase_ = Phase::Off;
    return;
  }
  NimBLEDevice::setPower(9);  // dBm; the scanner was only -80 at arm's length

  NimBLEScan *scan = NimBLEDevice::getScan();
  scan->setScanCallbacks(&scanEvents_, false);
  scan->setMaxResults(0);  // callbacks only; nothing piles up in RAM
  scan->setInterval(100);
  scan->setWindow(50);

  client_ = NimBLEDevice::createClient();
  client_->setClientCallbacks(&clientEvents_, false);
  client_->setConnectionParams(kConnIntervalMin, kConnIntervalMax, 0, kSupervisionTimeout,
                               kInitScanInterval, kInitScanWindow);

  if (hasSaved_) {
    LOG_I("ble", "up, waiting for scanner %s", saved_.toString().c_str());
  } else {
    LOG_I("ble", "up, no scanner paired yet (hold BOOT 3s, then release)");
  }
  enterWaiting();
}

void BleScanner::enterWaiting() {
  line_.reset();
  stopScan();
  if (hasSaved_) {
    phase_ = Phase::Waiting;
    armReconnect();
  } else {
    phase_ = Phase::Idle;  // nothing to look for; leave the radio to WiFi
    disarmReconnect();
  }
}

void BleScanner::armReconnect() {
  if (reconnectArmed_ || client_->isConnected()) return;
  linkUp_ = false;
  connectFailed_ = false;
  client_->setConnectTimeout(kReconnectWindowMs);
  // Asynchronous: returns at once and the controller keeps listening for the
  // scanner; onConnect fires the moment it is heard. Attributes are kept
  // unless the last attempt gave reason to doubt them.
  const bool keepAttributes = !refreshAttributes_;
  if (client_->connect(saved_, !keepAttributes, true)) {
    reconnectArmed_ = true;
    refreshAttributes_ = false;
  } else {
    retryAt_ = millis() + kRetryMs;
  }
}

void BleScanner::disarmReconnect() {
  if (reconnectArmed_ && !client_->isConnected()) client_->cancelConnect();
  reconnectArmed_ = false;
}

void BleScanner::startScan() {
  NimBLEScan *scan = NimBLEDevice::getScan();
  scan->setActiveScan(true);    // the scan response carries the name
  scan->start(0, false, true);  // until stopped; restart clears the duplicate filter
}

void BleScanner::stopScan() {
  NimBLEScan *scan = NimBLEDevice::getScan();
  if (scan->isScanning()) scan->stop();
}

bool BleScanner::looksLikeOurKind(const NimBLEAdvertisedDevice *device) const {
  if (!device->isConnectable()) return false;
  return device->isAdvertisingService(kAdvertService) ||
         device->isAdvertisingService(kDataService) || device->getName() == kAdvertName;
}

bool BleScanner::subscribe() {
  // After the first connection these come from the cache: no discovery.
  NimBLERemoteService *service = client_->getService(kDataService);
  NimBLERemoteCharacteristic *barcodes =
      service ? service->getCharacteristic(kBarcodeCharacteristic) : nullptr;
  const bool ok =
      barcodes && barcodes->canNotify() &&
      barcodes->subscribe(true, [this](NimBLERemoteCharacteristic *, uint8_t *data, size_t length,
                                       bool) { onData(data, length); });
  if (!ok) {
    LOG_W("ble", Err::ScannerLost, "no 0xAE30/0xAE02 barcode notifications on %s",
          client_->getPeerAddress().toString().c_str());
    refreshAttributes_ = true;  // maybe a stale cache; rediscover next time
    return false;
  }
  line_.reset();
  connected_ = true;
  return true;
}

bool BleScanner::connectFresh(const NimBLEAddress &address) {
  client_->setConnectTimeout(SCANNER_BLE_CONNECT_TIMEOUT_MS);
  if (!client_->connect(address, true, false)) {
    LOG_W("ble", Err::ScannerLost, "could not connect to %s", address.toString().c_str());
    return false;
  }
  if (!subscribe()) {
    client_->disconnect();
    return false;
  }
  return true;
}

bool BleScanner::poll(String &barcode) {
  if (phase_ == Phase::Off) return false;
  const uint32_t now = millis();

  if (bytes_ != loggedBytes_) {
    LOG_D("ble", "received %u bytes", static_cast<unsigned>(bytes_ - loggedBytes_));
    loggedBytes_ = bytes_;
  }

  // Bytes first, one at a time, so a notification carrying two barcodes is
  // not cut at the first one -- the rest stays in the stream for next time.
  char c;
  while (xStreamBufferReceive(stream_, &c, 1, 0) == 1) {
    if (line_.push(c, now)) {
      barcode = line_.take();
      return true;
    }
  }
  if (line_.flushIfIdle(now, kIdleFlushMs)) {
    barcode = line_.take();
    return true;
  }

  if (disconnected_) {
    disconnected_ = false;
    connected_ = false;
    reconnectArmed_ = false;
    if (phase_ == Phase::Connected) {
      // Usually the scanner going to sleep. It advertises again when the
      // trigger wakes it, and the standing request is already waiting.
      droppedAt_ = now;
      // The number as well as the text: NimBLE has no text for the common
      // ones (0x208, supervision timeout, is the scanner falling asleep).
      LOG_I("ble", "scanner disconnected (reason 0x%x %s); waiting for it",
            static_cast<unsigned>(disconnectReason_),
            NimBLEUtils::returnCodeToString(disconnectReason_));
      enterWaiting();
    }
  }

  switch (phase_) {
    case Phase::Waiting:
      if (linkUp_) {
        linkUp_ = false;
        reconnectArmed_ = false;
        const uint32_t linkUpAt = linkUpAt_;
        if (subscribe()) {
          phase_ = Phase::Connected;
          reconnects_++;
          LOG_I("ble", "scanner back: link up to notifications in %u ms",
                static_cast<unsigned>(millis() - linkUpAt));
        } else {
          client_->disconnect();
          retryAt_ = now + kRetryMs;
        }
      } else if (connectFailed_) {
        // The request ran its window with no scanner in sight, or was
        // cancelled. Nothing is wrong; re-arm.
        connectFailed_ = false;
        reconnectArmed_ = false;
      }
      if (phase_ == Phase::Waiting && !reconnectArmed_ && !client_->isConnected() &&
          static_cast<int32_t>(now - retryAt_) >= 0) {
        armReconnect();
      }
      break;

    case Phase::Pairing: {
      if (static_cast<int32_t>(now - pairUntil_) >= 0) {
        finishPairing(false);
        break;
      }
      NimBLEAddress pick;
      bool ready = false;
      portENTER_CRITICAL(&mux_);
      if (candidateSeen_ && now - candidateFirstAt_ >= kPickNearestMs) {
        pick = candidate_;
        ready = true;
        candidateSeen_ = false;
        candidateRssi_ = -127;
      }
      portEXIT_CRITICAL(&mux_);
      if (!ready || client_->isConnected()) break;

      stopScan();
      if (connectFresh(pick)) {
        save(pick);
        phase_ = Phase::Connected;
        finishPairing(true);
      } else {
        startScan();  // keep looking while the window lasts
      }
      break;
    }

    default:
      break;
  }
  return false;
}

void BleScanner::startPairing() {
  if (phase_ == Phase::Off) return;
  LOG_I("ble", "pairing: looking for a scanner for %us", SCANNER_PAIR_WINDOW_MS / 1000);
  disarmReconnect();
  if (client_->isConnected()) client_->disconnect();
  connected_ = false;
  linkUp_ = false;

  portENTER_CRITICAL(&mux_);
  candidateSeen_ = false;
  candidateRssi_ = -127;
  portEXIT_CRITICAL(&mux_);

  pairUntil_ = millis() + SCANNER_PAIR_WINDOW_MS;
  phase_ = Phase::Pairing;
  Feedback::setScannerPairing(true);
  Feedback::beepPairingStarted();
  startScan();
}

void BleScanner::finishPairing(bool ok) {
  Feedback::setScannerPairing(false);
  if (ok) {
    LOG_I("ble", "paired with scanner %s", saved_.toString().c_str());
    Feedback::beepPaired();
    return;
  }
  LOG_W("ble", Err::ScannerLost, "pairing: no scanner found in %us",
        SCANNER_PAIR_WINDOW_MS / 1000);
  Feedback::beepError();
  enterWaiting();  // back to the scanner we already had, if any
}

void BleScanner::forgetScanner() {
  eraseStored();
  hasSaved_ = false;
  if (phase_ == Phase::Off) return;
  disarmReconnect();
  if (client_->isConnected()) client_->disconnect();
  connected_ = false;
  if (phase_ == Phase::Pairing) Feedback::setScannerPairing(false);
  LOG_I("ble", "scanner forgotten");
  enterWaiting();
}

void BleScanner::suspend() {
  if (phase_ == Phase::Off) return;
  LOG_I("ble", "pausing bluetooth (frees its memory and the radio)");
  if (phase_ == Phase::Pairing) Feedback::setScannerPairing(false);
  phase_ = Phase::Off;  // first: the scan callback reads it on the BLE task
  stopScan();
  disarmReconnect();
  if (client_ && client_->isConnected()) client_->disconnect();
  // true: also release the controller's memory, not just the host's. The
  // client goes with it.
  NimBLEDevice::deinit(true);
  client_ = nullptr;
  connected_ = false;
  linkUp_ = false;
  connectFailed_ = false;
  disconnected_ = false;
  reconnectArmed_ = false;
  suspended_ = true;
}

void BleScanner::resume() {
  if (!suspended_) return;
  suspended_ = false;
  LOG_I("ble", "resuming bluetooth");
  begin();
}

// ---------------------------------------------------------------- storage

void BleScanner::loadSaved() {
  Preferences prefs;
  prefs.begin(kPrefs, false);
  // isKey first: getString on a missing key logs an error on every boot of a
  // board that simply has no scanner paired yet.
  const String address = prefs.isKey("addr") ? prefs.getString("addr", "") : String();
  const uint8_t type = prefs.getUChar("type", BLE_ADDR_PUBLIC);
  prefs.end();
  if (address.length() == 0) return;
  saved_ = NimBLEAddress(std::string(address.c_str()), type);
  hasSaved_ = !saved_.isNull();
}

void BleScanner::save(const NimBLEAddress &address) {
  Preferences prefs;
  prefs.begin(kPrefs, false);
  prefs.putString("addr", address.toString().c_str());
  prefs.putUChar("type", address.getType());
  prefs.end();
  saved_ = address;
  hasSaved_ = true;
}

void BleScanner::eraseStored() {
  Preferences prefs;
  prefs.begin(kPrefs, false);
  prefs.clear();
  prefs.end();
}
#endif

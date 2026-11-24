/**
 * ScanCart — ESP32-S3 firmware.
 *
 * A barcode scanner hangs off this board. Every scan is turned into a signed
 * HTTPS request carrying the device's identity and the barcode, and the server
 * puts the product on the right household's shopping list.
 *
 * Two rules shape most of the design:
 *
 *   1. The person gets their feedback immediately. The beep happens when the
 *      barcode is read, not when the network answers. Nobody should stand at
 *      the bin waiting for WiFi.
 *
 *   2. A scan is never lost. If the network is down the scan goes to a queue on
 *      flash, which survives a power cut, and every scan carries an id made
 *      here — so re-sending after a dropped connection can never duplicate an
 *      item on the list.
 */
#include <Arduino.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include <time.h>

#include "core/BootInfo.h"
#include "core/SafeMode.h"
#include "core/SelfTest.h"
#include "core/Watchdog.h"
#include "data/ScanQueue.h"
#include "device/DeviceIdentity.h"
#include "device/Provisioning.h"
#include "hmi/Feedback.h"
#include "net/RetryPolicy.h"
#include "net/Uplink.h"
#include "ota/Ota.h"
#include "platform/Diagnostics.h"
#include "platform/ErrorCodes.h"
#include "platform/Health.h"
#include "platform/Log.h"
#include "platform/Power.h"
#include "platform/Validate.h"
#include "platform/config.h"

#if defined(SCANNER_BLE)
// Kept by name, not only behind `scanner`: the BOOT button and the server's
// pair/forget commands talk to it directly.
#include "scan/BleScanner.h"
BleScanner bleScanner;
#endif

#if defined(SCANNER_USB_HID) && defined(SCANNER_BLE)
// The product: the 2.4GHz dongle and a Bluetooth LE scanner, whichever is there.
#include "scan/CompositeScanner.h"
#include "scan/UsbHidScanner.h"
UsbHidScanner usbScanner;
CompositeScanner scanner(usbScanner, bleScanner);
#elif defined(SCANNER_USB_HID)
#include "scan/UsbHidScanner.h"
UsbHidScanner scanner;
#elif defined(SCANNER_BLE)
BleScanner &scanner = bleScanner;
#elif defined(SCANNER_UART)
#include "scan/UartScanner.h"
UartScanner scanner;
#else
// Default: no scanner hardware at all, barcodes typed into the monitor.
#include "scan/SerialScanner.h"
SerialScanner scanner;
#endif

namespace {

enum class State { Boot, Portal, Connecting, SyncTime, Registering, WaitingToPair, Ready };
State state = State::Boot;

bool claimed = false;
uint32_t lastHeartbeat = 0;
uint32_t lastClaimPoll = 0;

// Backoff without sleeping. Each of these used to be a delay() of up to a
// minute, during which the device ignored the button, the scanner and the LED.
RetryPolicy wifiRetry(WIFI_RETRY_FIRST_S, WIFI_RETRY_MAX_S);
RetryPolicy serverRetry(SERVER_RETRY_FIRST_S, SERVER_RETRY_MAX_S);
RetryPolicy queueRetry(SERVER_RETRY_FIRST_S, SERVER_RETRY_MAX_S);
RetryPolicy timeRetry(SERVER_RETRY_FIRST_S, SERVER_RETRY_MAX_S);

String lastBarcode;
uint32_t lastBarcodeAt = 0;

uint32_t resetHeldSince = 0;
uint32_t portalCloseAt = 0;

// The outcome of a command we ran, waiting to go out on the next heartbeat.
// Only set for commands that do not reboot the board -- one that does has no
// next heartbeat to carry the ack on.
String pendingAckId_;
bool pendingAckFailed_ = false;

void handleFactoryReset();

/**
 * Installs an offered update if this is a quiet moment for it (OtaPolicy has
 * the rules). Bluetooth is shut down for the download -- it holds ~95KB and
 * half the radio -- and brought back if the attempt fails. On success the
 * board restarts and this never returns.
 */
void maybeUpdate() {
  OtaPolicy::Moment moment;
  moment.now = millis();
  moment.online = WiFi.status() == WL_CONNECTED;
  moment.onProbation = Ota::onProbation();
#if defined(SCANNER_BLE)
  moment.busy = bleScanner.pairing();
#endif
  moment.queueEmpty = ScanQueue::isEmpty();
  moment.scannedSinceBoot = lastBarcode.length() > 0;
  moment.lastScanAt = lastBarcodeAt;
  // Mains-powered today. The battery device answers "charging?" here.
  moment.powerOk = true;
  moment.freeHeap = Health::freeHeap();
  if (!Ota::updateDue(moment)) return;

#if defined(SCANNER_BLE)
  bleScanner.suspend();
#endif
  Ota::installOffered();  // returns only on failure
#if defined(SCANNER_BLE)
  bleScanner.resume();
#endif
  Feedback::setState(ScanQueue::isEmpty() ? Feedback::State::Ready : Feedback::State::Queued);
}

/**
 * Everything that has to keep running while the firmware is waiting on
 * something slow. Connecting to WiFi and syncing the clock each block for
 * many seconds, and during those the LED must keep animating, the setup page
 * must keep answering, and -- the one that actually bit us -- the reset
 * button must still be watched. A button you can only press when the device
 * is idle is not a reset button.
 */
void pump() {
  Watchdog::feed();
  Feedback::tick();
  Provisioning::tick();
  Health::tick();
  Power::tick();
  handleFactoryReset();
}

// The scanner's part of the power line (platform/Power.h).
void powerProbe(char *out, size_t capacity) {
#if defined(SCANNER_BLE)
  uint32_t waiting = 0, linked = 0, total = 0;
  bleScanner.takeShares(waiting, linked, total);
  if (total == 0) total = 1;
  snprintf(out, capacity, "ble wait %u%% listen %u%% linked %u%%",
           static_cast<unsigned>(waiting * 100ull / total), bleScanner.listenPercent(),
           static_cast<unsigned>(linked * 100ull / total));
#else
  (void)capacity;
  out[0] = '\0';
#endif
}

String makeScanId() {
  // A v4-shaped identifier from the hardware RNG. Uniqueness is what matters
  // here, not conformance -- this is only ever a database key.
  char buffer[37];
  const char *hex = "0123456789abcdef";
  for (uint8_t i = 0; i < 36; i++) {
    if (i == 8 || i == 13 || i == 18 || i == 23) { buffer[i] = '-'; continue; }
    buffer[i] = hex[esp_random() & 0x0F];
  }
  buffer[14] = '4';
  buffer[19] = hex[8 + (esp_random() & 0x03)];
  buffer[36] = '\0';
  return String(buffer);
}

bool connectWifi() {
  String ssid, password;
  Provisioning::loadCredentials(ssid, password);
  if (ssid.length() == 0) return false;

  Feedback::setState(Feedback::State::Connecting);
  LOG_I("wifi", "connecting to %s", ssid.c_str());

  WiFi.mode(WIFI_STA);
#if defined(SCANNER_BLE)
  // WiFi and Bluetooth share one radio, and ESP-IDF requires WiFi modem sleep
  // while both run: the coexistence scheduler hands the antenna to Bluetooth
  // in WiFi's sleep slots. The cost is some latency on incoming packets.
  WiFi.setSleep(true);
#else
  WiFi.setSleep(false);  // a sleeping radio adds seconds to the first request
#endif
  WiFi.begin(ssid.c_str(), password.c_str());

  const uint32_t deadline = millis() + WIFI_CONNECT_TIMEOUT_MS;
  while (WiFi.status() != WL_CONNECTED && millis() < deadline) {
    pump();  // the phone is still watching this connect happen
    delay(20);
  }
  return WiFi.status() == WL_CONNECTED;
}

/**
 * TLS cannot be verified without a correct clock: the device boots believing
 * it is 1970, and from there every certificate looks "not yet valid". This has
 * to succeed before the first HTTPS request, not alongside it.
 */
bool syncTime() {
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  const uint32_t deadline = millis() + 15000;
  while (time(nullptr) < 1700000000 && millis() < deadline) {
    pump();
    delay(20);
  }
  const bool ok = time(nullptr) >= 1700000000;
  if (ok) {
    LOG_I("time", "clock synced");
  } else {
    // Without a clock, certificate validity cannot be judged and every TLS
    // handshake fails. Worth saying plainly, because the resulting errors all
    // point at the network instead.
    LOG_E("time", Err::TimeSyncFailed, "no NTP; TLS will reject every certificate");
    Health::countError(Err::TimeSyncFailed);
  }
  return ok;
}

/** Everything a factory reset forgets, from the button or from the server. */
void wipeDevice() {
  ScanQueue::clear();
  Provisioning::clearCredentials();
  DeviceIdentity::factoryReset();
#if defined(SCANNER_BLE)
  BleScanner::eraseStored();  // the next owner pairs their own scanner
#endif
}

/**
 * The BOOT button. Held 10s: factory reset, as always. With a Bluetooth
 * scanner build, a shorter hold does something gentler on release: 3-8s pairs
 * a new scanner. A beep at 3s says "let go now to pair".
 */
void handleFactoryReset() {
  if (digitalRead(PIN_FACTORY_RESET) == LOW) {
    if (resetHeldSince == 0) resetHeldSince = millis();
    const uint32_t held = millis() - resetHeldSince;
#if defined(SCANNER_BLE)
    static bool hinted = false;
    if (held < SCANNER_PAIR_HOLD_MS) hinted = false;
    if (held >= SCANNER_PAIR_HOLD_MS && !hinted) {
      hinted = true;
      Feedback::beepHint();
    }
#endif
    if (held > FACTORY_RESET_HOLD_MS) {
      LOG_C("reset", Err::None, "factory reset: wiping this device");
      Feedback::setState(Feedback::State::Error);
      Feedback::tick();
      wipeDevice();
      SafeMode::expectRestart();
      delay(500);
      ESP.restart();
    }
  } else {
#if defined(SCANNER_BLE)
    if (resetHeldSince != 0) {
      const uint32_t held = millis() - resetHeldSince;
      if (held >= SCANNER_PAIR_HOLD_MS && held < SCANNER_PAIR_MAX_HOLD_MS) {
        bleScanner.startPairing();
      }
    }
#endif
    resetHeldSince = 0;
  }
}

/** Sends a scan, or queues it. Feedback has already been given by this point. */
void deliver(const ScanQueue::Entry &entry) {
  if (WiFi.status() != WL_CONNECTED) {
    ScanQueue::push(entry);
    Feedback::setState(Feedback::State::Queued);
    Feedback::beepQueued();
    return;
  }

  const Uplink::ScanResult result = Uplink::sendScan(entry, false);
  if (!result.delivered) {
    ScanQueue::push(entry);
    Feedback::setState(Feedback::State::Queued);
    Feedback::beepQueued();
    return;
  }

  if (result.held) {
    // Accepted, but this device is not paired yet. Kept for 24 hours and
    // attached to the list the moment someone claims it.
    Feedback::beepUnknown();
    return;
  }

  Feedback::setState(Feedback::State::Ready);
  if (!result.identified) {
    Feedback::beepUnknown();
    LOG_I("scan", "%s -> unknown product", entry.barcode.c_str());
  } else {
    LOG_I("scan", "%s -> %s", entry.barcode.c_str(), result.name.c_str());
  }
}

void onBarcode(const String &barcode) {
  // A USB-HID scanner is a keyboard, and a keyboard can send anything. A
  // misread, a stuck modifier, or something plugged into that socket that is
  // not a scanner all arrive here looking like input. Rejected at the door,
  // so nothing further down has to treat a barcode as suspect.
  if (!Validate::barcode(barcode)) {
    LOG_W("scan", Err::ScannerBadInput, "ignoring %u bytes that are not a barcode",
          barcode.length());
    Health::countError(Err::ScannerBadInput);
    Feedback::beepUnknown();
    return;
  }

  const uint32_t now = millis();

  // The same code twice inside the debounce window is one physical scan that
  // the scanner reported twice -- a trigger held a fraction too long.
  if (barcode == lastBarcode && now - lastBarcodeAt < SCAN_DEBOUNCE_MS) return;

  lastBarcode = barcode;
  lastBarcodeAt = now;

  ScanQueue::Entry entry;
  entry.scanId = makeScanId();
  entry.barcode = barcode;
  entry.timestamp = static_cast<uint32_t>(time(nullptr));
  entry.quantity = 1;

  // Scanning the same item again on purpose is meant to mean "make it two".
  // We do not try to work that out here: the server merges by barcode inside
  // a single statement, which is the only place that can also get it right
  // when two people in the house scan the same thing at the same moment.

  // Before anything touches the network.
  Feedback::beepAccepted();

  deliver(entry);
}

/**
 * Acts on a command the server attached to a heartbeat reply.
 *
 * Parsed properly rather than searched for substrings. The old version asked
 * whether the text contained "reboot" anywhere, which is a decision about
 * restarting someone's device made by a string match -- and ArduinoJson was
 * already a dependency.
 */
void handleCommand(const String &command) {
  if (command.length() == 0) return;

  JsonDocument doc;
  if (deserializeJson(doc, command)) {
    LOG_W("cmd", Err::BadResponse, "command was not valid JSON, ignoring");
    Health::countError(Err::BadResponse);
    return;
  }

  const char *action = doc["action"] | "";
  if (strlen(action) == 0) {
    LOG_W("cmd", Err::BadResponse, "command has no action");
    return;
  }
  const char *id = doc["id"] | "";
  LOG_I("cmd", "server asked for: %s", action);

  if (strcmp(action, "locate") == 0) {
    Feedback::flashLocate();
    if (strlen(id) > 0) {
      pendingAckId_ = id;
      pendingAckFailed_ = false;
    }

  } else if (strcmp(action, "reprovision") == 0) {
    // Forget the home network and reopen the setup portal, keeping identity
    // and the queue intact -- this is a WiFi change, not a factory reset.
    LOG_I("cmd", "reprovision on request: forgetting WiFi credentials");
    Provisioning::clearCredentials();
    SafeMode::expectRestart();
    delay(200);
    ESP.restart();

  } else if (strcmp(action, "reboot") == 0) {
    LOG_I("cmd", "restarting on request");
    SafeMode::expectRestart();
    delay(200);
    ESP.restart();

#if defined(SCANNER_BLE)
  } else if (strcmp(action, "pair_scanner") == 0) {
    // Same as releasing BOOT after 3s: listen for a scanner for a minute. The
    // ack says the board started looking, not that a scanner was found --
    // the heartbeat's scanner_attached says that, once it is.
    bleScanner.startPairing();
    if (strlen(id) > 0) {
      pendingAckId_ = id;
      pendingAckFailed_ = false;
    }

  } else if (strcmp(action, "forget_scanner") == 0) {
    bleScanner.forgetScanner();
    if (strlen(id) > 0) {
      pendingAckId_ = id;
      pendingAckFailed_ = false;
    }
#endif

  } else if (strcmp(action, "factory_reset") == 0) {
    LOG_C("cmd", Err::None, "factory reset on request");
    wipeDevice();
    SafeMode::expectRestart();
    delay(200);
    ESP.restart();

  } else if (strcmp(action, "diagnostics") == 0) {
    // Sent on request rather than every minute. It is a few kilobytes, and
    // nobody needs the partition layout sixty times an hour.
    LOG_I("cmd", "sending a diagnostics snapshot");
    if (!Uplink::sendDiagnostics(Diagnostics::snapshot())) {
      LOG_W("cmd", Err::ServerUnreachable, "diagnostics could not be delivered");
    }

  } else if (strcmp(action, "log_level") == 0) {
    // Turning up detail on one misbehaving device, without a cable and
    // without shipping a build.
    const int level = doc["level"] | static_cast<int>(Log::Level::Info);
    if (level >= 0 && level <= static_cast<int>(Log::Level::Off)) {
      Log::setLevel(static_cast<Log::Level>(level));
      LOG_I("cmd", "log level is now %d", level);
    }

  } else {
    LOG_W("cmd", Err::None, "unknown action '%s'", action);
  }
}

}  // namespace

/**
 * Ordered on purpose, cheapest and most diagnostic first.
 *
 * Anything that can tell us why the last boot failed runs before anything that
 * might fail again -- there is no point initialising a radio if we cannot log
 * what happens next. Nothing here is allowed to stop the boot: a component
 * that will not start is recorded and skipped, because a device that reaches
 * the network with a broken scanner can be fixed remotely, and one that hangs
 * in setup cannot.
 */
void setup() {
  Serial.begin(115200);
  delay(200);

  Log::begin(LOG_DEFAULT_LEVEL);
  LOG_I("boot", "ScanCart %s (%s scanner)", FIRMWARE_VERSION, scanner.name());

  BootInfo::begin();
  SafeMode::begin();
  Health::begin();

  pinMode(PIN_FACTORY_RESET, INPUT_PULLUP);
  Feedback::begin();
  DeviceIdentity::begin();
  LOG_I("boot", "device %s", DeviceIdentity::serial().c_str());

  // Started before anything slow, so a hang in storage or the radio is caught
  // rather than looking like a dead board.
  Watchdog::begin(WATCHDOG_TIMEOUT_S);

  if (SafeMode::active()) {
    // Deliberately minimal. No storage, no scanner, no queue -- the fewer
    // things that start, the better the chance of starting at all, and all
    // this boot has to achieve is being reachable enough to be repaired.
    LOG_C("boot", Err::None, "safe mode: network and updates only");
    // Still read: if the reason we are here is a bad update, the probation
    // clock is the thing that undoes it without anyone fetching a cable.
    Ota::begin();
    Feedback::setState(Feedback::State::Error);
    state = Provisioning::hasCredentials() ? State::Connecting : State::Portal;
    return;
  }

  ScanQueue::begin();
  Uplink::begin();
  Ota::begin();
  Power::begin(powerProbe);

  // After storage, because two of the checks need it; before the scanner,
  // because a board that fails these will fail more confusingly later.
  SelfTest::run();

  scanner.begin();

  state = Provisioning::hasCredentials() ? State::Connecting : State::Portal;
}

void loop() {
  // Rest first. Arduino calls loop() back to back with no pause, so without
  // this the core spun at 100% at 240MHz all day doing nothing -- the single
  // largest draw on the board. A short sleep lets the idle task clock-gate the
  // core (WAITI) between iterations. Nothing here needs to be faster: the USB
  // host and Bluetooth run on their own tasks and buffer what arrives, and the
  // LED and buzzer are timed in tens of milliseconds.
  vTaskDelay(pdMS_TO_TICKS(LOOP_IDLE_MS));

  // pump() is also called from inside every long wait, so these run whether
  // the firmware is idle or halfway through connecting.
  pump();

  // A boot counts as healthy once it has been up a while and has reached the
  // server. Not at the end of setup(): firmware that crashes two minutes in
  // would clear the counter every time and never reach safe mode.
  if (claimed && millis() > HEALTHY_AFTER_MS) SafeMode::markHealthy();

  // Confirms a new image once it has proved itself, or rolls the device back
  // if it never does. Runs before the state machine so a firmware that hangs
  // somewhere below still gets rolled back.
  Ota::tick();

  if (SafeMode::active()) {
    // Only the parts that let someone fix this device from elsewhere.
    if (state == State::Portal || state == State::Connecting) {
      // fall through to the state machine below
    } else if (millis() - lastHeartbeat > HEARTBEAT_INTERVAL_MS) {
      lastHeartbeat = millis();
      String command;
      if (Uplink::heartbeat(false, 0, command)) handleCommand(command);
    }
  }

  switch (state) {
    case State::Boot:
      state = State::Connecting;
      break;

    case State::Portal: {
      if (!Provisioning::portalRunning()) Provisioning::startPortal();
      Provisioning::tick();

      String ssid, password;
      if (Provisioning::consumeSubmission(ssid, password)) {
        if (!Validate::ssid(ssid) || !Validate::wifiPassword(password)) {
          // Saving these would produce a device that fails to connect for a
          // reason the page never mentions, and the person retypes the same
          // thing. Say so while they are still standing there.
          LOG_W("wifi", Err::ConfigInvalid, "setup form rejected: bad ssid or passphrase");
          Provisioning::setProgress(Provisioning::Progress::WifiFailed,
                                    "שם רשת או סיסמה לא תקינים");
          break;
        }
        Provisioning::saveCredentials(ssid, password);
        Provisioning::setProgress(Provisioning::Progress::Connecting);
        state = State::Connecting;
      }
      break;
    }

    case State::Connecting: {
      if (!wifiRetry.ready()) {
        // Waiting out the backoff, but still answering the button, the portal
        // and the LED. This used to be delay(1500).
        Feedback::setState(Feedback::State::Error);
        break;
      }

      if (connectWifi()) {
        wifiRetry.succeeded();
        if (wifiRetry.attempts() > 0) Health::countWifiReconnect();
        Provisioning::setProgress(Provisioning::Progress::SyncingTime);
        state = State::SyncTime;
        break;
      }

      wifiRetry.failed();
      Health::countError(Err::WifiConnectFailed);

      if (wifiRetry.attempts() >= WIFI_MAX_ATTEMPTS) {
        // Almost always a mistyped password or a network that has moved on.
        // The portal stays up and says so, rather than leaving a blinking LED
        // as the only clue.
        LOG_W("wifi", Err::WifiConnectFailed, "%u attempts failed; reopening setup",
              wifiRetry.attempts());
        wifiRetry.reset();
        Provisioning::clearCredentials();
        if (!Provisioning::portalRunning()) Provisioning::startPortal();
        Provisioning::setProgress(Provisioning::Progress::WifiFailed);
        state = State::Portal;
      } else {
        LOG_W("wifi", Err::WifiConnectFailed, "attempt %u failed, next in %us",
              wifiRetry.attempts(), wifiRetry.currentDelaySeconds());
        Feedback::setState(Feedback::State::Error);
      }
      break;
    }

    case State::SyncTime:
      if (!timeRetry.ready()) break;

      if (syncTime()) {
        timeRetry.succeeded();
        Provisioning::setProgress(Provisioning::Progress::Registering);
        state = DeviceIdentity::isRegistered() ? State::WaitingToPair : State::Registering;
      } else {
        timeRetry.failed();
        Provisioning::setProgress(Provisioning::Progress::ServerFailed, "אין שעון מדויק");
        Feedback::setState(Feedback::State::Error);
      }
      break;

    case State::Registering: {
      if (!serverRetry.ready()) break;

      String pairingCode;
      bool claimedNow = false;
      if (Uplink::registerDevice(Provisioning::claimToken(), pairingCode, claimedNow)) {
        serverRetry.succeeded();
        // Normally the code we proposed. If the server had to allocate a
        // different one, the setup page corrects itself on its next poll.
        DeviceIdentity::setPairingCode(pairingCode);
        DeviceIdentity::setRegistered(true);
        if (claimedNow) {
          // The user typed the app's code into the setup page, so pairing
          // already happened server side. There is nothing to wait for.
          LOG_I("pair", "claimed during registration");
          claimed = true;
          Feedback::beepPaired();
          Feedback::setState(Feedback::State::Ready);
          Provisioning::setProgress(Provisioning::Progress::Paired);
          portalCloseAt = millis() + 8000;
          state = State::Ready;
          break;
        }
        LOG_I("pair", "pairing code %s", pairingCode.c_str());
        Provisioning::setProgress(Provisioning::Progress::WaitingToPair);
        state = State::WaitingToPair;
      } else {
        serverRetry.failed();
        Health::countError(Err::ServerUnreachable);
        LOG_W("net", Err::ServerUnreachable, "registration failed, next in %us",
              serverRetry.currentDelaySeconds());
        Provisioning::setProgress(Provisioning::Progress::ServerFailed, "השרת לא זמין");
        Feedback::setState(Feedback::State::Error);
      }
      break;
    }

    case State::WaitingToPair: {
      Feedback::setState(Feedback::State::WaitingToPair);
      Provisioning::tick();

      if (millis() - lastClaimPoll > CLAIM_POLL_INTERVAL_MS) {
        lastClaimPoll = millis();
        bool isClaimed = false;
        if (Uplink::checkClaimed(isClaimed) && isClaimed) {
          claimed = true;
          Feedback::beepPaired();
          Feedback::setState(Feedback::State::Ready);
          Provisioning::setProgress(Provisioning::Progress::Paired);
          // Leave the page up briefly so whoever is watching sees it finish,
          // then get off the air -- an open access point is a standing
          // invitation once setup is done.
          portalCloseAt = millis() + 8000;
          state = State::Ready;
        }
      }
      // Scanning is allowed while unpaired: the server holds those scans and
      // attaches them on claim, so the owner's first test scan is not wasted.
      break;
    }

    case State::Ready:
      if (Provisioning::portalRunning()) {
        Provisioning::tick();
        if (portalCloseAt != 0 && millis() > portalCloseAt) {
          Provisioning::stopPortal();
          portalCloseAt = 0;
        }
      }

      if (WiFi.status() != WL_CONNECTED) {
        Feedback::setState(Feedback::State::Queued);
        state = State::Connecting;
        break;
      }

      if (!ScanQueue::isEmpty() && queueRetry.ready()) {
        if (Uplink::flushQueue() > 0) {
          queueRetry.succeeded();
          Health::markServerSync();
          if (ScanQueue::isEmpty()) Feedback::setState(Feedback::State::Ready);
        } else {
          queueRetry.failed();
          Health::countError(Err::ServerUnreachable);
        }
      }

      if (millis() - lastHeartbeat > HEARTBEAT_INTERVAL_MS) {
        lastHeartbeat = millis();
        String command;
        const String ackId = pendingAckId_;
        if (Uplink::heartbeat(scanner.attached(), scanner.keysSeen(), command, ackId, pendingAckFailed_)) {
          // Only clear once the server actually has it; a lost reply means
          // we try again on the next beat rather than drop the ack silently.
          if (ackId.length() > 0 && pendingAckId_ == ackId) pendingAckId_ = "";
          handleCommand(command);
        }
      }

      maybeUpdate();
      break;
  }

  // No scanner in safe mode: it is not needed to repair the device, and every
  // subsystem left running is one more that can hang.
  if (SafeMode::active()) return;

  String barcode;
  if (scanner.poll(barcode) && barcode.length() > 0) onBarcode(barcode);
}

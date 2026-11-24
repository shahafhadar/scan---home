/**
 * Diagnostic: which BLE protocol does a barcode scanner speak?
 *
 * The ESP32-S3 has no Bluetooth Classic radio, only LE, so a scanner sitting
 * in a classic mode ("Bluetooth HID" / "Bluetooth SPP") is invisible to it no
 * matter what the firmware does. The HBA-W7 / TD-W7 has a separate
 * "Bluetooth BLE" setting barcode, and this tool answers what that mode looks
 * like on the air, in enough detail to write a reader for it:
 *
 *   1. every advertiser nearby, with name, appearance and advertised services
 *   2. for anything that looks like a scanner (name has BARCODE/SCAN, HID in
 *      the advert, or a keyboard/barcode appearance): connect, bond if it is a
 *      HID device, and dump every service and characteristic with its
 *      properties -- including the HID Report Map and each report's id/type
 *   3. subscribe to every notify/indicate characteristic and print the raw
 *      bytes of whatever arrives for two minutes, while barcodes are scanned
 *
 * Step 3 is the one that settles it: a BLE-HID scanner sends 8-byte keyboard
 * reports on 0x2A4D, a "transparent serial" one sends the barcode text on a
 * vendor characteristic.
 *
 * Output comes out of the socket marked UART/COM, like the product builds, so
 * the same cable that flashes it also shows it:
 *
 *   ./dev.sh pio run -e blescan -t upload -t monitor
 */
#include <Arduino.h>
#include <NimBLEDevice.h>

namespace {

constexpr uint16_t HID_SERVICE = 0x1812;
constexpr uint16_t HID_REPORT_MAP = 0x2A4B;
constexpr uint16_t HID_REPORT_REFERENCE = 0x2908;
constexpr uint16_t DEVICE_INFO_SERVICE = 0x180A;
constexpr uint16_t APPEARANCE_KEYBOARD = 0x03C1;
constexpr uint16_t APPEARANCE_BARCODE_SCANNER = 0x03C8;

constexpr int LIST_RSSI = -95;     // print named adverts at least this strong
constexpr int NEAR_RSSI = -60;     // also print unnamed adverts this close
constexpr uint32_t LISTEN_MS = 120000;

// Set this to probe one specific device instead of every candidate.
const char *kOnlyAddress = nullptr;

uint32_t notifications = 0;

/**
 * A public address is a registered OUI and says nothing more. A random one
 * carries its sub-type in the top two bits -- reading those bits off a public
 * address (the old version of this tool did) mislabels it.
 */
const char *addressKind(const NimBLEAddress &address) {
  if (address.isPublic()) return "public";
  if (address.isStatic()) return "random-static";
  if (address.isRpa()) return "random-resolvable";
  return "random-nonresolvable";
}

bool nameLooksLikeScanner(std::string name) {
  for (auto &c : name) c = toupper(static_cast<unsigned char>(c));
  for (const char *word : {"BARCODE", "SCAN", "HBA", "W7", "TD-", "BLE"}) {
    if (name.find(word) != std::string::npos) return true;
  }
  return false;
}

bool looksLikeScanner(const NimBLEAdvertisedDevice *device) {
  if (kOnlyAddress) return device->getAddress().toString() == kOnlyAddress;
  if (nameLooksLikeScanner(device->getName())) return true;
  if (device->isAdvertisingService(NimBLEUUID(HID_SERVICE))) return true;
  if (device->haveAppearance()) {
    const uint16_t a = device->getAppearance();
    if (a == APPEARANCE_KEYBOARD || a == APPEARANCE_BARCODE_SCANNER) return true;
  }
  return false;
}

void hexdump(const uint8_t *data, size_t length, size_t limit) {
  const size_t shown = length < limit ? length : limit;
  for (size_t i = 0; i < shown; i++) Serial.printf("%02x ", data[i]);
  if (shown < length) Serial.printf("... (+%u bytes)", static_cast<unsigned>(length - shown));
  Serial.print(" | ");
  for (size_t i = 0; i < shown; i++) {
    const char c = static_cast<char>(data[i]);
    Serial.print(c >= 0x20 && c < 0x7F ? c : '.');
  }
  Serial.println();
}

void printAdvert(const NimBLEAdvertisedDevice *device) {
  Serial.printf("  %s %-20s rssi %4d name '%s'", device->getAddress().toString().c_str(),
                addressKind(device->getAddress()), device->getRSSI(), device->getName().c_str());
  if (device->haveAppearance()) Serial.printf(" appearance 0x%04x", device->getAppearance());
  for (uint8_t i = 0; i < device->getServiceUUIDCount(); i++) {
    Serial.printf(" svc %s", device->getServiceUUID(i).toString().c_str());
  }
  Serial.printf("%s\n", device->isConnectable() ? "" : " (not connectable)");
}

void onNotify(NimBLERemoteCharacteristic *characteristic, uint8_t *data, size_t length,
              bool isNotify) {
  notifications++;
  Serial.printf("  [%s h=0x%04x %s] %2u bytes: ", isNotify ? "notify" : "indicate",
                characteristic->getHandle(), characteristic->getUUID().toString().c_str(),
                static_cast<unsigned>(length));
  hexdump(data, length, 64);
}

void describe(NimBLEClient *client) {
  for (auto *service : client->getServices(true)) {
    const bool hid = service->getUUID() == NimBLEUUID(HID_SERVICE);
    Serial.printf("  service %s%s\n", service->getUUID().toString().c_str(), hid ? "  <-- HID" : "");

    for (auto *ch : service->getCharacteristics(true)) {
      Serial.printf("    char h=0x%04x %s [%s%s%s%s%s]\n", ch->getHandle(), ch->getUUID().toString().c_str(),
                    ch->canRead() ? "R" : "", ch->canWrite() ? "W" : "",
                    ch->canWriteNoResponse() ? "w" : "", ch->canNotify() ? "N" : "",
                    ch->canIndicate() ? "I" : "");

      if (ch->canRead()) {
        NimBLEAttValue value = ch->readValue();
        const bool reportMap = ch->getUUID() == NimBLEUUID(HID_REPORT_MAP);
        Serial.printf("      value (%u bytes): ", static_cast<unsigned>(value.length()));
        hexdump(value.data(), value.length(), reportMap ? 512 : 32);
      }

      for (auto *d : ch->getDescriptors(true)) {
        if (d->getUUID() == NimBLEUUID(HID_REPORT_REFERENCE)) {
          NimBLEAttValue ref = d->readValue();
          if (ref.length() >= 2) {
            const uint8_t type = ref.data()[1];
            Serial.printf("      report id %u, %s\n", ref.data()[0],
                          type == 1 ? "input" : type == 2 ? "output" : type == 3 ? "feature" : "?");
          }
        }
      }
    }
  }
}

void subscribeAll(NimBLEClient *client) {
  for (auto *service : client->getServices(false)) {
    for (auto *ch : service->getCharacteristics(false)) {
      if (!ch->canNotify() && !ch->canIndicate()) continue;
      const bool ok = ch->subscribe(ch->canNotify(), onNotify, true);
      Serial.printf("  subscribe h=0x%04x %s: %s\n", ch->getHandle(), ch->getUUID().toString().c_str(),
                    ok ? "ok" : "REFUSED");
    }
  }
}

void probe(const NimBLEAdvertisedDevice *device, bool listen) {
  Serial.printf("\n>>> connecting to %s (%s, rssi %d, '%s')\n", device->getAddress().toString().c_str(),
                addressKind(device->getAddress()), device->getRSSI(), device->getName().c_str());

  NimBLEClient *client = NimBLEDevice::createClient();
  client->setConnectTimeout(8000);  // ms in 2.x
  if (!client->connect(device)) {
    Serial.println("    refused the connection");
    NimBLEDevice::deleteClient(client);
    return;
  }
  Serial.printf("    connected, mtu %u\n", client->getMTU());

  // HID over GATT needs an encrypted link before the reports can be read or
  // subscribed to; a transparent-serial scanner usually does not.
  const bool hid = client->getService(NimBLEUUID(HID_SERVICE)) != nullptr;
  if (hid) {
    Serial.println("    HID service present -- bonding (Just Works)...");
    Serial.printf("    bond: %s\n", client->secureConnection() ? "ok" : "FAILED");
  }

  describe(client);
  if (client->getValue(NimBLEUUID(DEVICE_INFO_SERVICE), NimBLEUUID((uint16_t)0x2A29)).length()) {
    Serial.printf("    manufacturer: %s\n",
                  client->getValue(NimBLEUUID(DEVICE_INFO_SERVICE), NimBLEUUID((uint16_t)0x2A29)).c_str());
  }

  if (listen && client->isConnected()) {
    subscribeAll(client);
    notifications = 0;
    Serial.println("\n*** LISTENING for 2 minutes -- scan a few barcodes now ***");
    Serial.println("*** try: an EAN-13 product, a QR code, and the same barcode twice ***\n");
    const uint32_t until = millis() + LISTEN_MS;
    while (client->isConnected() && millis() < until) delay(50);
    Serial.printf("\n*** done listening: %u notifications, %s ***\n", notifications,
                  client->isConnected() ? "still connected" : "scanner disconnected");
    Serial.println(hid ? "*** verdict: BLE HID (keyboard reports) ***"
                       : "*** verdict: no HID service -- look for the barcode text above ***");
  }

  if (client->isConnected()) client->disconnect();
  NimBLEDevice::deleteClient(client);
}

/**
 * How often the scanner advertises while it is awake and unconnected. This is
 * what sets how little the product firmware can afford to listen: with an
 * advert every A ms, a scan window a little longer than A catches it in the
 * first window, so the radio can sleep the rest of the interval without
 * slowing the reconnect.
 *
 * Tracked by address, not by looks: the HBA-W7 puts its name and service in
 * the scan response, so its plain adverts -- the ones being timed -- carry
 * nothing to recognise it by. The scanner is picked out after the scan, and
 * its address's timestamps are printed.
 *
 * Build with -DBLESCAN_TIMING_ONLY (PLATFORMIO_BUILD_FLAGS) to only measure:
 * no connection, so a woken scanner keeps advertising until it sleeps again.
 */
class AdvertTimer : public NimBLEScanCallbacks {
 public:
  // With duplicates on, NimBLE calls this once per advertisement (scan
  // responses excluded).
  void onDiscovered(const NimBLEAdvertisedDevice *device) override {
    if (!device->isConnectable()) return;
    const uint32_t now = millis();
    for (size_t i = 0; i < used_; i++) {
      if (tracks_[i].address == device->getAddress()) {
        if (tracks_[i].count < kMax) tracks_[i].stamps[tracks_[i].count++] = now;
        return;
      }
    }
    if (used_ < kTracks) {
      tracks_[used_].address = device->getAddress();
      tracks_[used_].stamps[0] = now;
      tracks_[used_].count = 1;
      used_++;
    }
  }
  void reset() { used_ = 0; }
  void print(const NimBLEAddress &address) const {
    for (size_t t = 0; t < used_; t++) {
      const Track &track = tracks_[t];
      if (!(track.address == address)) continue;
      if (track.count < 3) {
        Serial.printf("advert timing: only %u adverts seen\n", static_cast<unsigned>(track.count));
        return;
      }
      static uint32_t gaps[kMax];
      size_t n = 0;
      for (size_t i = 1; i < track.count; i++) gaps[n++] = track.stamps[i] - track.stamps[i - 1];
      // Median, not mean: a missed advert doubles one gap.
      for (size_t i = 1; i < n; i++) {
        for (size_t j = i; j > 0 && gaps[j - 1] > gaps[j]; j--) {
          const uint32_t g = gaps[j];
          gaps[j] = gaps[j - 1];
          gaps[j - 1] = g;
        }
      }
      Serial.printf("advert timing: %u adverts over %u ms, gap min %u / p25 %u / median %u / p90 %u / max %u ms\n",
                    static_cast<unsigned>(track.count),
                    static_cast<unsigned>(track.stamps[track.count - 1] - track.stamps[0]),
                    static_cast<unsigned>(gaps[0]), static_cast<unsigned>(gaps[n / 4]),
                    static_cast<unsigned>(gaps[n / 2]), static_cast<unsigned>(gaps[(n * 9) / 10]),
                    static_cast<unsigned>(gaps[n - 1]));
      return;
    }
    Serial.println("advert timing: no adverts tracked for the scanner");
  }

 private:
  static constexpr size_t kMax = 400;
  static constexpr size_t kTracks = 8;
  struct Track {
    NimBLEAddress address;
    uint32_t stamps[kMax];
    size_t count = 0;
  };
  Track tracks_[kTracks];
  size_t used_ = 0;
};

AdvertTimer advertTimer;

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(600);
  Serial.println("\n=== BLE scanner probe ===");
  Serial.println("Scanner: scan 'Clear the pairing information', then 'Bluetooth BLE', and keep it");
  Serial.println("awake (press the trigger) next to the board.\n");
  NimBLEDevice::init("scan-home-probe");
  NimBLEDevice::setPower(9);  // dBm
  NimBLEDevice::setSecurityAuth(true, false, true);  // bond, no MITM, secure connections
  NimBLEDevice::setSecurityIOCap(BLE_HS_IO_NO_INPUT_OUTPUT);
  Serial.printf("bonds stored on this board: %d\n", NimBLEDevice::getNumBonds());
}

void loop() {
  NimBLEScan *scan = NimBLEDevice::getScan();
  scan->setActiveScan(true);
  scan->setInterval(100);
  scan->setWindow(99);
  scan->setScanCallbacks(&advertTimer, true);  // every advert, for the timing
  advertTimer.reset();

#if defined(BLESCAN_TIMING_ONLY)
  constexpr uint32_t kScanMs = 15000;  // a whole wake, not just its start
#else
  constexpr uint32_t kScanMs = 6000;
#endif
  Serial.printf("--- scanning %us ---\n", static_cast<unsigned>(kScanMs / 1000));
  NimBLEScanResults found = scan->getResults(kScanMs, false);  // blocking, ms

  int best = -1;
  for (int i = 0; i < found.getCount(); i++) {
    const NimBLEAdvertisedDevice *device = found.getDevice(i);
    const bool candidate = looksLikeScanner(device);
    const bool named = !device->getName().empty();
    if (candidate || (named && device->getRSSI() >= LIST_RSSI) || (!named && device->getRSSI() >= NEAR_RSSI)) {
      Serial.print(candidate ? "* " : "  ");
      printAdvert(device);
    }
    if (candidate && (best < 0 || device->getRSSI() > found.getDevice(best)->getRSSI())) best = i;
  }

  if (best >= 0) {
    advertTimer.print(found.getDevice(best)->getAddress());
#if !defined(BLESCAN_TIMING_ONLY)
    probe(found.getDevice(best), true);
#endif
  } else {
    // Only list. Connecting to whatever else is in range (locks, speakers,
    // the TV) proves nothing about the scanner and is not ours to poke at.
    Serial.println("no scanner-like advert. Is the scanner in BLE mode, awake, next to the board?");
  }

  scan->clearResults();
  Serial.println();
  delay(1500);
}

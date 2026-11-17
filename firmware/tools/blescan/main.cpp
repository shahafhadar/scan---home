/**
 * Diagnostic: is this scanner reachable over BLE, and does it speak HID?
 *
 * The ESP32-S3 has no Bluetooth Classic radio, only LE, so a scanner sitting
 * in a classic mode is invisible to it no matter what the firmware does. That
 * much a scan can answer.
 *
 * What a scan cannot answer is whether a device that *is* advertising speaks
 * HID: advertisement packets are small, and plenty of BLE keyboards leave the
 * HID service out of theirs and only expose it once connected. So this goes
 * one step further -- it connects to nearby candidates and enumerates their
 * GATT services, which is the only account that settles the question.
 *
 * Devices using resolvable private addresses are skipped: that is what phones
 * and watches use, and a barcode scanner has no reason to hide.
 *
 *   ./dev.sh pio run -e blescan -t upload -t monitor
 */
#include <Arduino.h>
#include <NimBLEDevice.h>

namespace {

constexpr uint16_t HID_SERVICE = 0x1812;
constexpr uint16_t BATTERY_SERVICE = 0x180F;
constexpr uint16_t DEVICE_INFO_SERVICE = 0x180A;
constexpr int NEAR_RSSI = -55;

// Set this to probe one specific device instead of every candidate.
const char *kOnlyAddress = nullptr;

// The scanner's Bluetooth Classic address. Dual-mode devices often carry a BLE
// identity in the same OUI, sometimes one digit off, so anything from this
// vendor prefix is worth flagging even if it advertises nothing else.
const char *kHuntPrefix = "e4:df:20";

/**
 * BLE addresses carry their own type in the top bits. Phones and watches use
 * resolvable private addresses that rotate; a peripheral like a scanner
 * normally has a fixed public address from a registered OUI.
 */
const char *addressKind(const NimBLEAddress &address) {
  const uint8_t top = address.getNative()[5] >> 6;
  switch (top) {
    case 0b11: return "random-static";
    case 0b01: return "private-resolvable";
    case 0b00: return "public";
    default:   return "private-nonresolvable";
  }
}

bool worthProbing(NimBLEAdvertisedDevice &device) {
  if (kOnlyAddress) return device.getAddress().toString() == kOnlyAddress;
  if (device.getRSSI() < NEAR_RSSI) return false;
  // Skip the rotating addresses -- those are the phones in the room.
  return String(addressKind(device.getAddress())) != "private-resolvable";
}

void probe(NimBLEAdvertisedDevice &device) {
  const std::string address = device.getAddress().toString();
  Serial.printf("\n>>> connecting to %s (%s, rssi %d)\n", address.c_str(),
                addressKind(device.getAddress()), device.getRSSI());

  NimBLEClient *client = NimBLEDevice::createClient();
  client->setConnectTimeout(8);

  if (!client->connect(&device)) {
    Serial.println("    refused the connection");
    NimBLEDevice::deleteClient(client);
    return;
  }
  Serial.printf("    connected. name: %s\n", client->getValue(NimBLEUUID((uint16_t)DEVICE_INFO_SERVICE),
                                                              NimBLEUUID((uint16_t)0x2A29)).c_str());

  std::vector<NimBLERemoteService *> *services = client->getServices(true);
  bool hasHid = false;
  for (auto *service : *services) {
    const std::string uuid = service->getUUID().toString();
    const bool isHid = service->getUUID() == NimBLEUUID((uint16_t)HID_SERVICE);
    if (isHid) hasHid = true;
    Serial.printf("    %s service %s\n", isHid ? "HID ->" : "      ", uuid.c_str());
    if (service->getUUID() == NimBLEUUID((uint16_t)BATTERY_SERVICE)) {
      Serial.println("           (battery level available)");
    }
  }

  if (hasHid) {
    Serial.println("\n    *** THIS IS A BLE HID DEVICE. We can read it. ***");
  } else {
    Serial.println("    no HID service -- not a BLE keyboard");
  }

  client->disconnect();
  NimBLEDevice::deleteClient(client);
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(600);
  Serial.println("\n=== BLE probe: connecting to nearby candidates ===");
  Serial.println("Put the scanner in Bluetooth pairing mode, held near the board.\n");
  NimBLEDevice::init("scancart-probe");
  NimBLEDevice::setPower(ESP_PWR_LVL_P9);
}

void loop() {
  NimBLEScan *scan = NimBLEDevice::getScan();
  scan->setActiveScan(true);
  scan->setInterval(100);
  scan->setWindow(99);

  Serial.println("--- scanning ---");
  NimBLEScanResults found = scan->start(6, false);

  // First pass: is anything from the scanner's vendor prefix on the air?
  for (int i = 0; i < found.getCount(); i++) {
    NimBLEAdvertisedDevice device = found.getDevice(i);
    const std::string address = device.getAddress().toString();
    if (address.rfind(kHuntPrefix, 0) == 0) {
      Serial.printf("*** VENDOR MATCH %s rssi %d name '%s' ***\n", address.c_str(),
                    device.getRSSI(), device.getName().c_str());
      probe(device);
    }
  }

  uint8_t probed = 0;
  for (int i = 0; i < found.getCount(); i++) {
    NimBLEAdvertisedDevice device = found.getDevice(i);
    if (device.isAdvertisingService(NimBLEUUID(HID_SERVICE))) {
      Serial.printf("[HID in advert] %s\n", device.getAddress().toString().c_str());
      probe(device);
      probed++;
      continue;
    }
    if (!worthProbing(device)) continue;
    probe(device);
    if (++probed >= 6) break;  // keep each round short
  }

  if (probed == 0) {
    Serial.println("nothing close enough with a fixed address to probe.");
    Serial.println("Is the scanner on, in Bluetooth mode, and next to the board?");
  }

  scan->clearResults();
  Serial.println("\n");
  delay(2000);
}

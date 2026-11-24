#include "device/DeviceIdentity.h"

#include <Preferences.h>
#include <bootloader_random.h>
#include <esp_mac.h>
#include <esp_random.h>
#include <mbedtls/sha256.h>

namespace {
Preferences prefs;
String serial_;
String secretHash_;
String pairingCode_;
bool registered_ = false;

String toHex(const uint8_t *bytes, size_t length) {
  static const char digits[] = "0123456789abcdef";
  String out;
  out.reserve(length * 2);
  for (size_t i = 0; i < length; i++) {
    out += digits[bytes[i] >> 4];
    out += digits[bytes[i] & 0x0F];
  }
  return out;
}

String sha256Hex(const String &input) {
  uint8_t digest[32];
  mbedtls_sha256_context ctx;
  mbedtls_sha256_init(&ctx);
  mbedtls_sha256_starts(&ctx, 0);
  mbedtls_sha256_update(&ctx, reinterpret_cast<const uint8_t *>(input.c_str()), input.length());
  mbedtls_sha256_finish(&ctx, digest);
  mbedtls_sha256_free(&ctx);
  return toHex(digest, sizeof(digest));
}
}  // namespace

namespace DeviceIdentity {

void begin() {
  prefs.begin("scancart", false);

  uint8_t mac[6] = {0};
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  serial_ = "SC-" + toHex(mac, 6);
  serial_.toUpperCase();

  String secret = prefs.getString("secret", "");
  const bool needSecret = secret.length() != 64;
  const bool needCode = prefs.getString("pairing", "").length() != 6;

  // esp_random() is only truly random once the RF hardware is running, and
  // this runs long before WiFi starts. Without this the very first boot --
  // the one boot that mints the device's permanent secret -- would draw from
  // a predictable source, and a predictable secret is a forgeable device.
  if (needSecret || needCode) bootloader_random_enable();

  if (needSecret) {
    uint8_t raw[32];
    esp_fill_random(raw, sizeof(raw));
    secret = toHex(raw, sizeof(raw));
    prefs.putString("secret", secret);
  }
  // The server stores this hash and signs against it; the secret itself is
  // never transmitted.
  secretHash_ = sha256Hex(secret);

  pairingCode_ = prefs.getString("pairing", "");
  if (needCode) {
    // No 0/O/1/I: this gets read off a screen and typed by hand.
    static const char alphabet[] = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    pairingCode_ = "";
    for (uint8_t i = 0; i < 6; i++) {
      pairingCode_ += alphabet[esp_random() % (sizeof(alphabet) - 1)];
    }
    prefs.putString("pairing", pairingCode_);
  }

  if (needSecret || needCode) bootloader_random_disable();

  registered_ = prefs.getBool("registered", false);
}

const String &serial() { return serial_; }
const String &secretHash() { return secretHash_; }
const String &pairingCode() { return pairingCode_; }

void setPairingCode(const String &code) {
  pairingCode_ = code;
  prefs.putString("pairing", code);
}

bool isRegistered() { return registered_; }

void setRegistered(bool value) {
  registered_ = value;
  prefs.putBool("registered", value);
}

void factoryReset() {
  prefs.clear();
  prefs.end();
}

}  // namespace DeviceIdentity

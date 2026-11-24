#include "core/SelfTest.h"

#include <Arduino.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <esp_flash.h>

#include "device/DeviceIdentity.h"
#include "ota/Signature.h"
#include "platform/ErrorCodes.h"
#include "platform/Log.h"
#include "platform/config.h"

namespace {

uint16_t results = 0;
char failureList[64] = "";

struct Definition {
  SelfTest::Check bit;
  const char *name;
  bool (*probe)();
};

bool probeNvs() {
  Preferences prefs;
  if (!prefs.begin("selftest", false)) return false;
  // Written and read back rather than merely opened: a full NVS partition
  // opens happily and then refuses every write.
  const uint32_t token = millis();
  prefs.putULong("t", token);
  const bool ok = prefs.getULong("t", 0) == token;
  prefs.end();
  return ok;
}

bool probeFilesystem() { return LittleFS.totalBytes() > 0; }

bool probeFlashSize() {
  uint32_t size = 0;
  if (esp_flash_get_size(nullptr, &size) != ESP_OK) return false;
  // The partition table runs to 16MB. On a smaller chip the bootloader rejects
  // it and resets every 24ms, before a single line of this code runs -- so
  // reaching here with the wrong size means something stranger, and it is
  // worth naming rather than guessing at later.
  return size >= EXPECTED_FLASH_BYTES;
}

bool probeSigningKey() { return Signature::selfTest(); }

bool probeIdentity() { return DeviceIdentity::serial().length() > 0; }

constexpr Definition kChecks[] = {
    {SelfTest::Nvs,        "nvs",      probeNvs},
    {SelfTest::Filesystem, "fs",       probeFilesystem},
    {SelfTest::FlashSize,  "flash",    probeFlashSize},
    {SelfTest::SigningKey, "key",      probeSigningKey},
    {SelfTest::Identity,   "identity", probeIdentity},
};

}  // namespace

namespace SelfTest {

void run() {
  results = 0;
  failureList[0] = '\0';

  for (const auto &check : kChecks) {
    if (check.probe()) {
      results |= check.bit;
      continue;
    }
    if (failureList[0] != '\0') strncat(failureList, ",", sizeof(failureList) - strlen(failureList) - 1);
    strncat(failureList, check.name, sizeof(failureList) - strlen(failureList) - 1);
  }

  if (allPassed()) {
    LOG_I("self", "all checks passed");
  } else {
    // Loud, because every one of these produces symptoms somewhere else.
    LOG_C("self", Err::None, "SELF TEST FAILED: %s", failureList);
  }
}

uint16_t passed() { return results; }

bool allPassed() {
  uint16_t all = 0;
  for (const auto &check : kChecks) all |= check.bit;
  return results == all;
}

const char *failureNames() { return failureList; }

}  // namespace SelfTest

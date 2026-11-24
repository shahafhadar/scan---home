#include "core/SafeMode.h"

#include <Arduino.h>
#include <Preferences.h>

#include "platform/Log.h"
#include "platform/config.h"

namespace {
bool inSafeMode = false;
uint8_t failures = 0;
bool healthy = false;
}  // namespace

namespace SafeMode {

void begin() {
  Preferences prefs;
  if (!prefs.begin("safemode", false)) {
    // If NVS itself will not open we cannot count boots, so assume the best
    // and carry on -- refusing to start would be a worse failure than the one
    // we are guarding against.
    LOG_W("safe", Err::StorageFailure, "no boot counter; safe mode unavailable");
    return;
  }

  failures = prefs.getUChar("failures", 0);

  if (prefs.getBool("planned", false)) {
    // We restarted this device on purpose. Not a crash, so not a failure.
    prefs.putBool("planned", false);
    prefs.end();
    LOG_I("safe", "planned restart; not counted against this device");
    return;
  }

  // Incremented now, cleared later by markHealthy(). A boot that dies halfway
  // leaves the increment behind, which is exactly the signal we want.
  prefs.putUChar("failures", failures + 1);
  prefs.end();

  if (failures >= SAFE_MODE_FAILED_BOOTS) {
    inSafeMode = true;
    LOG_C("safe", Err::None, "%u boots without reaching a healthy state -- SAFE MODE", failures);
    LOG_C("safe", Err::None, "wifi, logging and updates only. The device is waiting to be fixed.");
  } else if (failures > 0) {
    LOG_W("safe", Err::None, "%u boot(s) since the last healthy run", failures);
  }
}

bool active() { return inSafeMode; }

void markHealthy() {
  if (healthy) return;
  healthy = true;

  Preferences prefs;
  if (prefs.begin("safemode", false)) {
    prefs.putUChar("failures", 0);
    prefs.end();
  }
  if (failures > 0) LOG_I("safe", "healthy; boot failure count cleared");
}

uint8_t failedBoots() { return failures; }

void expectRestart() {
  Preferences prefs;
  if (!prefs.begin("safemode", false)) return;
  prefs.putBool("planned", true);
  prefs.end();
}

}  // namespace SafeMode

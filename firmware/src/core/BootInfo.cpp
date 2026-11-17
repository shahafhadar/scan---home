#include "core/BootInfo.h"

#include <Preferences.h>
#include <esp_system.h>

#include "platform/Log.h"

namespace {

const char *reasonText = "UNKNOWN";
bool wasFault = false;
uint32_t boots = 0;

const char *describe(esp_reset_reason_t reason, bool &fault) {
  fault = false;
  switch (reason) {
    case ESP_RST_POWERON:  return "POWERON";
    case ESP_RST_SW:       return "SW";
    case ESP_RST_DEEPSLEEP:return "DEEPSLEEP";
    case ESP_RST_USB:      return "USB";
    case ESP_RST_EXT:      return "EXTERNAL";
    case ESP_RST_PANIC:     fault = true; return "PANIC";
    case ESP_RST_INT_WDT:   fault = true; return "INT_WDT";
    case ESP_RST_TASK_WDT:  fault = true; return "TASK_WDT";
    case ESP_RST_WDT:       fault = true; return "OTHER_WDT";
    case ESP_RST_BROWNOUT:  fault = true; return "BROWNOUT";
    default:                fault = true; return "UNKNOWN";
  }
}

}  // namespace

namespace BootInfo {

void begin() {
  reasonText = describe(esp_reset_reason(), wasFault);

  Preferences prefs;
  if (prefs.begin("boot", false)) {
    boots = prefs.getUInt("count", 0) + 1;
    prefs.putUInt("count", boots);
    prefs.end();
  }

  if (wasFault) {
    // Loud on purpose. A fault reset is the single most useful line in the
    // log, and it is worth nothing if it scrolls past looking like everything
    // else.
    LOG_C("boot", Err::None, "restarted after a fault: %s (boot #%u)", reasonText, boots);
  } else {
    LOG_I("boot", "start: %s (boot #%u)", reasonText, boots);
  }

  // A brownout is a power problem wearing a software costume. Say so, because
  // the tempting fix -- disabling the detector -- turns clean restarts into
  // corrupted flash.
  if (String(reasonText) == "BROWNOUT") {
    LOG_C("boot", Err::None, "brownout: the supply sagged. Check the power source, not the code.");
  }
}

const char *resetReason() { return reasonText; }
bool lastResetWasFault() { return wasFault; }
uint32_t bootCount() { return boots; }
uint32_t uptimeSeconds() { return millis() / 1000; }

}  // namespace BootInfo

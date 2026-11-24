#include "core/Watchdog.h"

#include <Arduino.h>
#include <esp_task_wdt.h>

#include "platform/Log.h"

namespace {
bool active = false;
}

namespace Watchdog {

void begin(uint32_t timeoutSeconds) {
  // Arduino 3.x initialises a task watchdog of its own; reconfigure rather
  // than add a second one, or the two disagree about the timeout.
  esp_task_wdt_config_t config = {
      .timeout_ms = timeoutSeconds * 1000,
      .idle_core_mask = 0,   // idle tasks are not ours to police
      .trigger_panic = true, // panic gives a recorded reset reason, not a silent reboot
  };

  esp_err_t result = esp_task_wdt_reconfigure(&config);
  if (result == ESP_ERR_INVALID_STATE) result = esp_task_wdt_init(&config);
  if (result != ESP_OK) {
    LOG_E("wdt", Err::None, "could not start watchdog: %d", result);
    return;
  }

  if (esp_task_wdt_add(nullptr) != ESP_OK) {
    LOG_E("wdt", Err::None, "could not register the main loop");
    return;
  }

  active = true;
  LOG_I("wdt", "watching the main loop, %us timeout", timeoutSeconds);
}

void feed() {
  if (active) esp_task_wdt_reset();
}

void forceReset(const char *reason) {
  LOG_C("wdt", Err::None, "forcing a restart: %s", reason);
  delay(100);  // let the line reach the console before the chip goes
  esp_restart();
}

bool enabled() { return active; }

}  // namespace Watchdog

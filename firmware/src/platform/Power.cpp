#include "platform/Power.h"

#include <esp_heap_caps.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

#include <memory>
#include <new>

#include "platform/Health.h"
#include "platform/Log.h"
#include "platform/config.h"

namespace {

Power::Probe probe = nullptr;
uint32_t windowStartedAt = 0;
uint32_t requests = 0;
uint32_t requestMs = 0;

// Run-time counters at the start of the window. Microseconds, 32-bit: they
// wrap every ~71 minutes, and unsigned subtraction over a 5-minute window
// does not care.
uint32_t lastTotal = 0;
uint32_t lastIdle[2] = {0, 0};
bool haveBaseline = false;

/**
 * Reads the run-time counter of each core's idle task, and the clock they are
 * measured against. False if the snapshot could not be taken.
 */
bool sampleIdle(uint32_t &total, uint32_t idle[2]) {
  const UBaseType_t count = uxTaskGetNumberOfTasks() + 4;  // room for a task born meanwhile
  std::unique_ptr<TaskStatus_t[]> tasks(new (std::nothrow) TaskStatus_t[count]);
  if (!tasks) return false;
  configRUN_TIME_COUNTER_TYPE runTime = 0;
  const UBaseType_t filled = uxTaskGetSystemState(tasks.get(), count, &runTime);
  if (filled == 0) return false;

  idle[0] = idle[1] = 0;
  for (int core = 0; core < 2; core++) {
    const TaskHandle_t handle = xTaskGetIdleTaskHandleForCore(core);
    for (UBaseType_t i = 0; i < filled; i++) {
      if (tasks[i].xHandle == handle) idle[core] = tasks[i].ulRunTimeCounter;
    }
  }
  total = static_cast<uint32_t>(runTime);
  return true;
}

}  // namespace

namespace Power {

void begin(Probe extra) {
  probe = extra;
  windowStartedAt = millis();
  haveBaseline = sampleIdle(lastTotal, lastIdle);
}

void noteRequest(uint32_t ms) {
  requests++;
  requestMs += ms;
}

void tick() {
  const uint32_t now = millis();
  if (now - windowStartedAt < POWER_REPORT_INTERVAL_MS) return;
  const uint32_t seconds = (now - windowStartedAt) / 1000;
  windowStartedAt = now;

  char cpu[40] = "cpu ?";
  uint32_t total = 0;
  uint32_t idle[2] = {0, 0};
  if (sampleIdle(total, idle) && haveBaseline) {
    const uint32_t span = total - lastTotal;
    unsigned busy[2] = {0, 0};
    for (int core = 0; core < 2; core++) {
      const uint32_t idleSpan = idle[core] - lastIdle[core];
      busy[core] = span == 0 || idleSpan >= span
                       ? 0
                       : static_cast<unsigned>(100 - (static_cast<uint64_t>(idleSpan) * 100) / span);
    }
    snprintf(cpu, sizeof(cpu), "cpu0 %u%% cpu1 %u%%", busy[0], busy[1]);
  }
  lastTotal = total;
  lastIdle[0] = idle[0];
  lastIdle[1] = idle[1];
  haveBaseline = total != 0;

  char extra[64] = "";
  if (probe) probe(extra, sizeof(extra));

  const unsigned block =
      heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT) / 1024;
  LOG_I("power", "%us | %s | https %ux %u.%us | %s%sheap %uK min %uK block %uK",
        static_cast<unsigned>(seconds), cpu, static_cast<unsigned>(requests),
        static_cast<unsigned>(requestMs / 1000), static_cast<unsigned>((requestMs % 1000) / 100),
        extra, extra[0] ? " | " : "", static_cast<unsigned>(Health::freeHeap() / 1024),
        static_cast<unsigned>(Health::minFreeHeap() / 1024), block);
  requests = 0;
  requestMs = 0;
}

}  // namespace Power

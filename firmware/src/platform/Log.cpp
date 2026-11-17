#include "platform/Log.h"

#include <stdarg.h>

namespace {

Log::Level current = Log::Level::Info;

const char *levelName(Log::Level level) {
  switch (level) {
    case Log::Level::Debug:    return "DEBUG";
    case Log::Level::Info:     return "INFO ";
    case Log::Level::Warn:     return "WARN ";
    case Log::Level::Error:    return "ERROR";
    case Log::Level::Critical: return "CRIT ";
    default:                   return "?????";
  }
}

// Uptime, not wall clock. The device has no clock at all until NTP lands, and
// a log that says 1970 for the first ten seconds is worse than one that
// honestly counts from boot.
void writeTimestamp(char *out, size_t size) {
  const uint32_t ms = millis();
  snprintf(out, size, "%02u:%02u:%02u.%03u", static_cast<unsigned>(ms / 3600000),
           static_cast<unsigned>((ms / 60000) % 60), static_cast<unsigned>((ms / 1000) % 60),
           static_cast<unsigned>(ms % 1000));
}

}  // namespace

namespace Log {

void begin(Level level) { current = level; }
void setLevel(Level level) { current = level; }
Level level() { return current; }

void write(Level level, const char *module, Err error, const char *format, ...) {
  if (level < current || current == Level::Off) return;

  char timestamp[16];
  writeTimestamp(timestamp, sizeof(timestamp));

  // One fixed buffer, not a String: this runs on every log line, and growing
  // and freeing a heap string thousands of times an hour is exactly the
  // fragmentation that kills a device after a month.
  char message[192];
  va_list args;
  va_start(args, format);
  vsnprintf(message, sizeof(message), format, args);
  va_end(args);

  if (error == Err::None) {
    Serial.printf("[%s][%s][%-7s] %s\n", timestamp, levelName(level), module, message);
  } else {
    Serial.printf("[%s][%s][%-7s] %s %s\n", timestamp, levelName(level), module, errCode(error), message);
  }
}

}  // namespace Log

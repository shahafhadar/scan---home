#pragma once
#include <Arduino.h>

#include "platform/ErrorCodes.h"

/**
 * One place that decides what gets printed and how.
 *
 * Before this, every module called Serial.printf with its own format, which
 * meant no timestamps, no way to tell which module spoke, and no way to quiet
 * anything down in production without editing code. A line now carries when,
 * how bad, from where -- and for failures, the error code.
 *
 *   [00:04:12.331][WARN ][net    ] E004 server timeout
 */
namespace Log {

enum class Level : uint8_t { Debug = 0, Info = 1, Warn = 2, Error = 3, Critical = 4, Off = 5 };

void begin(Level level);
void setLevel(Level level);
Level level();

// `module` is a short tag: net, scan, queue, ota, boot. Keep it under 7
// characters so the columns stay aligned and lines stay readable.
void write(Level level, const char *module, Err error, const char *format, ...)
    __attribute__((format(printf, 4, 5)));

}  // namespace Log

// Macros rather than plain calls so the arguments are not even evaluated when
// the level is off -- string formatting in a hot loop costs more than the
// print does.
#define LOG_D(mod, ...) \
  do { if (Log::level() <= Log::Level::Debug) Log::write(Log::Level::Debug, mod, Err::None, __VA_ARGS__); } while (0)
#define LOG_I(mod, ...) \
  do { if (Log::level() <= Log::Level::Info) Log::write(Log::Level::Info, mod, Err::None, __VA_ARGS__); } while (0)
#define LOG_W(mod, err, ...) \
  do { if (Log::level() <= Log::Level::Warn) Log::write(Log::Level::Warn, mod, err, __VA_ARGS__); } while (0)
#define LOG_E(mod, err, ...) \
  do { if (Log::level() <= Log::Level::Error) Log::write(Log::Level::Error, mod, err, __VA_ARGS__); } while (0)
#define LOG_C(mod, err, ...) \
  do { if (Log::level() <= Log::Level::Critical) Log::write(Log::Level::Critical, mod, err, __VA_ARGS__); } while (0)

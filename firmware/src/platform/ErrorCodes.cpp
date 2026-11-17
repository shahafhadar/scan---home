#include "platform/ErrorCodes.h"

namespace {
struct Entry { Err code; const char *id; const char *text; };

// Kept as one table so a new code cannot be added to the enum and forgotten
// here -- the compiler will not catch that, but a single list makes it obvious.
constexpr Entry kTable[] = {
    {Err::None,              "E000", "ok"},
    {Err::WifiConnectFailed, "E001", "wifi connect failed"},
    {Err::WifiNoInternet,    "E002", "wifi up, no internet"},
    {Err::ServerUnreachable, "E003", "server unreachable"},
    {Err::ServerTimeout,     "E004", "server timeout"},
    {Err::ServerRejected,    "E005", "server rejected request"},
    {Err::BadResponse,       "E006", "unparseable response"},
    {Err::StorageFailure,    "E007", "storage failure"},
    {Err::QueueFull,         "E008", "queue full"},
    {Err::QueuePoisoned,     "E009", "queue entry giving up"},
    {Err::ScannerLost,       "E010", "scanner not present"},
    {Err::ScannerBadInput,   "E011", "invalid scanner input"},
    {Err::TimeSyncFailed,    "E012", "time sync failed"},
    {Err::OtaFailed,         "E013", "ota failed"},
    {Err::ConfigInvalid,     "E014", "config invalid"},
    {Err::OutOfMemory,       "E015", "out of memory"},
    {Err::OtaBadSignature,   "E016", "firmware signature rejected"},
    {Err::OtaRolledBack,     "E017", "new firmware rolled back"},
    {Err::ResponseTooLarge,  "E018", "response too large"},
};
}  // namespace

const char *errCode(Err error) {
  for (const auto &entry : kTable) {
    if (entry.code == error) return entry.id;
  }
  return "E999";
}

const char *errText(Err error) {
  for (const auto &entry : kTable) {
    if (entry.code == error) return entry.text;
  }
  return "unknown error";
}

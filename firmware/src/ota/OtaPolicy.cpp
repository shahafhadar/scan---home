#include "ota/OtaPolicy.h"

#include <cstring>

#include "platform/config.h"

namespace OtaPolicy {

namespace {

constexpr const char *kFirmwarePath = "/api/v1/firmware/";

// Copies only if it fits, terminator included. A truncated version or path
// would be a different version or path, and installing that is worse than
// installing nothing.
bool copyBounded(char *out, size_t capacity, const char *in) {
  if (!in) return false;
  const size_t length = std::strlen(in);
  if (length == 0 || length >= capacity) return false;
  std::memcpy(out, in, length + 1);
  return true;
}

bool isHex64(const char *text) {
  if (!text || std::strlen(text) != 64) return false;
  for (const char *c = text; *c; c++) {
    if (!((*c >= '0' && *c <= '9') || (*c >= 'a' && *c <= 'f'))) return false;
  }
  return true;
}

// Our own route and nothing else: no host (the device adds its own), no
// traversal, no query string, nothing a URL parser could read two ways.
bool isFirmwarePath(const char *path) {
  if (!path || std::strncmp(path, kFirmwarePath, std::strlen(kFirmwarePath)) != 0) return false;
  if (std::strstr(path, "..")) return false;
  for (const char *c = path; *c; c++) {
    const bool ok = (*c >= 'a' && *c <= 'z') || (*c >= 'A' && *c <= 'Z') ||
                    (*c >= '0' && *c <= '9') || *c == '/' || *c == '.' || *c == '-' || *c == '_';
    if (!ok) return false;
  }
  return true;
}

// millis() wraps every 49 days; compare by signed difference.
bool reached(uint32_t now, uint32_t at) { return static_cast<int32_t>(now - at) >= 0; }

}  // namespace

bool versionCode(const char *text, uint32_t &codeOut) {
  if (!text) return false;
  uint32_t parts[3] = {0, 0, 0};
  int part = 0;
  int digits = 0;
  for (const char *c = text;; c++) {
    if (*c >= '0' && *c <= '9') {
      if (++digits > 3) return false;
      parts[part] = parts[part] * 10 + static_cast<uint32_t>(*c - '0');
    } else if (*c == '.' || *c == '\0') {
      if (digits == 0) return false;
      if (*c == '\0') break;
      if (++part > 2) return false;
      digits = 0;
    } else {
      return false;
    }
  }
  if (part != 2) return false;
  codeOut = parts[0] * 1000000u + parts[1] * 1000u + parts[2];
  return true;
}

bool isNewer(const char *candidate, const char *current) {
  uint32_t a = 0, b = 0;
  return versionCode(candidate, a) && versionCode(current, b) && a > b;
}

bool Scheduler::offer(const char *version, const char *path, uint32_t size, const char *sha256) {
  Offer next;
  uint32_t code = 0;
  const bool valid = copyBounded(next.version, sizeof(next.version), version) &&
                     versionCode(next.version, code) && isFirmwarePath(path) &&
                     copyBounded(next.path, sizeof(next.path), path) && isHex64(sha256) &&
                     copyBounded(next.sha256, sizeof(next.sha256), sha256) && size > 0 &&
                     size <= OTA_SLOT_BYTES;
  if (!valid) {
    withdraw();
    return false;
  }
  next.size = size;

  const bool same = std::strcmp(next.version, offer_.version) == 0 &&
                    std::strcmp(next.sha256, offer_.sha256) == 0;
  if (!same) {
    failures_ = 0;
    retryAt_ = 0;
  }
  offer_ = next;
  return true;
}

void Scheduler::withdraw() {
  offer_ = Offer();
  failures_ = 0;
  retryAt_ = 0;
}

void Scheduler::reject(const char *version) {
  rejected_[0] = '\0';
  if (version) copyBounded(rejected_, sizeof(rejected_), version);
}

bool Scheduler::wanted(const char *running) const {
  if (!hasOffer() || !isNewer(offer_.version, running)) return false;
  return std::strcmp(offer_.version, rejected_) != 0;
}

bool Scheduler::due(const Moment &m, const char *running) const {
  if (!wanted(running)) return false;
  if (!m.online || m.onProbation || m.busy || !m.queueEmpty || !m.powerOk) return false;
  if (m.freeHeap < HEAP_CRITICAL_BYTES) return false;
  if (m.scannedSinceBoot && !reached(m.now, m.lastScanAt + OTA_QUIET_AFTER_SCAN_MS)) return false;
  if (failures_ > 0 && !reached(m.now, retryAt_)) return false;
  return true;
}

void Scheduler::failed(uint32_t now) {
  if (failures_ < 255) failures_++;
  const uint32_t wait = failures_ == 1   ? OTA_RETRY_FIRST_MS
                        : failures_ == 2 ? OTA_RETRY_SECOND_MS
                                         : OTA_RETRY_LONG_MS;
  retryAt_ = now + wait;
}

}  // namespace OtaPolicy

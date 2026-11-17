#include "platform/Validate.h"

#include "platform/config.h"

namespace {

bool hasControlCharacters(const String &value) {
  for (size_t i = 0; i < value.length(); i++) {
    const unsigned char c = static_cast<unsigned char>(value[i]);
    if (c < 0x20 || c == 0x7F) return true;
  }
  return false;
}

}  // namespace

namespace Validate {

bool barcode(const String &value) {
  const size_t length = value.length();
  // EAN-8 is the shortest thing worth treating as a product code; the longest
  // Code 128 anyone puts on a grocery item stays well inside 48.
  if (length < 4 || length > 48) return false;

  bool sawDigit = false;
  for (size_t i = 0; i < length; i++) {
    const char c = value[i];
    if (c >= '0' && c <= '9') { sawDigit = true; continue; }
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) continue;
    if (c == '-' || c == '.' || c == '_' || c == '/' || c == '+') continue;
    return false;
  }
  // Letters alone are a person typing into the monitor or a scanner in the
  // wrong mode, not a product.
  return sawDigit;
}

bool ssid(const String &value) {
  return value.length() >= 1 && value.length() <= 32 && !hasControlCharacters(value);
}

bool wifiPassword(const String &value) {
  if (value.length() == 0) return true;  // open network
  return value.length() >= 8 && value.length() <= 63 && !hasControlCharacters(value);
}

bool urlUnderHost(const String &url) {
  const String host = SCANCART_HOST;
  if (!url.startsWith(host)) return false;
  if (url.length() == host.length()) return true;
  const char next = url[host.length()];
  if (next != '/') return false;
  // No traversal, and nothing that would let a redirect out of the host.
  if (url.indexOf("..") >= 0) return false;
  if (url.indexOf('\\') >= 0) return false;
  return !hasControlCharacters(url);
}

bool version(const String &value) {
  if (value.length() == 0 || value.length() > 16) return false;
  for (size_t i = 0; i < value.length(); i++) {
    const char c = value[i];
    if ((c < '0' || c > '9') && c != '.') return false;
  }
  return true;
}

}  // namespace Validate

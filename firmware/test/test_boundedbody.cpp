/**
 * A chunked reply has no length to check before reading, so the cap is
 * enforced as the bytes arrive. These are the edges of that cap.
 *
 *   ./run-tests.sh
 */
#include <cstdio>
#include <cstring>
#include <string>

#include "net/BoundedBody.h"

namespace {

int failures = 0;

void check(bool condition, const std::string &what) {
  if (condition) return;
  std::printf("  FAIL  %s\n", what.c_str());
  failures++;
}

const uint8_t *bytes(const char *s) { return reinterpret_cast<const uint8_t *>(s); }

void fitsInPieces() {
  String out = "stale";
  BoundedBody body(out, 16);
  check(out.empty(), "starts from an empty body");
  check(body.append(bytes("{\"claimed\":"), 11) == 11, "first piece taken whole");
  check(body.append(bytes("true}"), 5) == 5, "second piece taken whole");
  check(out == "{\"claimed\":true}", "pieces joined in order");
  check(!body.overflowed(), "exactly at the limit is not an overflow");
}

void refusesPastTheLimit() {
  String out;
  BoundedBody body(out, 8);
  check(body.append(bytes("0123456789"), 10) == 8, "only the bytes that fit are taken");
  check(body.overflowed(), "one byte too many is an overflow");
  check(out.length() == 8, "never buffers past the limit");
  check(body.append(bytes("x"), 1) == 0, "nothing more once full");
}

void emptyBody() {
  String out;
  BoundedBody body(out, 8);
  check(body.append(bytes(""), 0) == 0, "an empty chunk is fine");
  check(!body.overflowed() && out.empty(), "an empty body is not an overflow");
}

}  // namespace

int main() {
  fitsInPieces();
  refusesPastTheLimit();
  emptyBody();
  std::printf("%s  boundedbody\n", failures == 0 ? "ok  " : "FAIL");
  return failures == 0 ? 0 : 1;
}

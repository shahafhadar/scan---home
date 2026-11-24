#!/usr/bin/env bash
# Compiles the hardware-independent firmware logic for the host and runs it.
#
# Not everything can be tested this way, but what can, should be: a barcode
# that decodes into plausible-but-wrong digits, or a URL check that accepts
# somebody else's host, are both faults that reach a customer and neither
# needs a board to find.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p .test-build

CXXFLAGS=(-std=c++17 -Wall -Wextra -Werror -I test/stub -I src)
status=0

build_and_run() {
  local name="$1"; shift
  "${CXX:-clang++}" "${CXXFLAGS[@]}" "$@" -o ".test-build/$name"
  "./.test-build/$name" || status=1
}

build_and_run test_hidkeymap test/test_hidkeymap.cpp src/scan/HidKeymap.cpp
build_and_run test_validate  test/test_validate.cpp  src/platform/Validate.cpp
build_and_run test_boundedbody test/test_boundedbody.cpp
build_and_run test_lineassembler test/test_lineassembler.cpp src/scan/LineAssembler.cpp
build_and_run test_otapolicy test/test_otapolicy.cpp src/ota/OtaPolicy.cpp

exit $status

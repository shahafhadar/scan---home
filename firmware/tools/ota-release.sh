#!/usr/bin/env bash
# Builds, signs and uploads one firmware release.
#
#   tools/ota-release.sh [env] [--dry-run]       env defaults to "usb"
#
# Run by the owner, on the machine that holds the signing key. Nothing here
# copies the key anywhere: openssl reads it in place to make one signature,
# and only the image and that signature leave this computer.
#
# What it does, and refuses to do:
#   1. builds the environment, and reads the image's own tag
#      (SCANCART-IMAGE|fw=|build=|hw=|host=) -- the server trusts that, not
#      this script, so the two are checked against each other here first
#   2. checks the signing key is the one whose public half the firmware
#      carries (src/ota/ota_public_key.h). A mismatch would sign images no
#      device accepts
#   3. signs SHA-256 of the image (ECDSA P-256, DER) and verifies the result
#   4. uploads image + signature to the host the image was built for. The
#      release lands as a draft (rollout 0%): no device sees it until it is
#      published -- see docs/firmware-ota.md
#
# Environment:
#   SCANCART_SIGNING_KEY   path to the private key (default: the one .pem in
#                          ~/.scancart-signing that is not a public key)
#   SCANCART_BYPASS        Vercel protection-bypass value, only if the target
#                          deployment is protected. Never printed.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_NAME="usb"
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    -*) echo "unknown option $arg" >&2; exit 2 ;;
    *) ENV_NAME="$arg" ;;
  esac
done

fail() { echo "ota-release: $*" >&2; exit 1; }

command -v openssl >/dev/null || fail "openssl is required"
command -v curl >/dev/null || fail "curl is required"

# ------------------------------------------------------------------ build
echo "==> building $ENV_NAME"
./dev.sh pio run -e "$ENV_NAME" >/dev/null || fail "build failed (run ./dev.sh pio run -e $ENV_NAME to see why)"
IMAGE=".pio/build/$ENV_NAME/firmware.bin"
[ -f "$IMAGE" ] || fail "no image at $IMAGE"

TAG=$(LC_ALL=C grep -a -o 'SCANCART-IMAGE|[^[:cntrl:]]*|' "$IMAGE" | head -1 || true)
[ -n "$TAG" ] || fail "the image carries no SCANCART-IMAGE tag; is this a product build?"
field() { printf '%s' "$TAG" | tr '|' '\n' | sed -n "s/^$1=//p"; }
VERSION=$(field fw)
BUILD=$(field build)
HW=$(field hw)
HOST=$(field host)

SOURCE_VERSION=$(sed -n 's/^#define FIRMWARE_VERSION "\(.*\)"/\1/p' src/platform/config.h | head -1)
# otatest is the deliberately broken image used to prove rollback; it carries
# its own version on purpose (docs/firmware-ota.md).
if [ "$ENV_NAME" != "otatest" ]; then
  [ "$VERSION" = "$SOURCE_VERSION" ] || fail "image says $VERSION but config.h says $SOURCE_VERSION"
fi
[[ "$VERSION" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]] || fail "version '$VERSION' is not major.minor.patch"
[[ "$HOST" == https://* ]] || fail "image talks to '$HOST'; releases are for https hosts only"

SIZE=$(wc -c <"$IMAGE" | tr -d ' ')
SHA256=$(shasum -a 256 "$IMAGE" | cut -d' ' -f1)
echo "    version $VERSION, build $BUILD, hw $HW"
echo "    $SIZE bytes, sha256 $SHA256"
echo "    for $HOST"

# ------------------------------------------------------------------ key
KEY="${SCANCART_SIGNING_KEY:-}"
if [ -z "$KEY" ]; then
  shopt -s nullglob
  candidates=()
  for f in "$HOME"/.scancart-signing/*.pem; do
    case "$(basename "$f")" in *pub*) ;; *) candidates+=("$f") ;; esac
  done
  [ "${#candidates[@]}" -eq 1 ] || fail "set SCANCART_SIGNING_KEY: found ${#candidates[@]} candidate keys in ~/.scancart-signing"
  KEY="${candidates[0]}"
fi
[ -r "$KEY" ] || fail "cannot read the signing key"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# The public key the firmware trusts, straight out of the header.
sed -n 's/^ *"\(.*\)\\n" *\\\{0,1\}$/\1/p' src/ota/ota_public_key.h >"$WORK/device.pub"
grep -q "BEGIN PUBLIC KEY" "$WORK/device.pub" || fail "could not read src/ota/ota_public_key.h"
openssl pkey -in "$KEY" -pubout -out "$WORK/key.pub" 2>/dev/null || fail "the signing key could not be read by openssl"
cmp -s <(openssl pkey -pubin -in "$WORK/device.pub" -outform DER) \
       <(openssl pkey -pubin -in "$WORK/key.pub" -outform DER) \
  || fail "this signing key does not match the public key compiled into the firmware"
echo "==> signing key matches the firmware's public key"

# ------------------------------------------------------------------ sign
openssl dgst -sha256 -sign "$KEY" -out "$WORK/image.sig" "$IMAGE"
openssl dgst -sha256 -verify "$WORK/device.pub" -signature "$WORK/image.sig" "$IMAGE" >/dev/null \
  || fail "the fresh signature does not verify; nothing was uploaded"
echo "==> signed and verified ($(wc -c <"$WORK/image.sig" | tr -d ' ')-byte signature)"

if [ "$DRY_RUN" = 1 ]; then
  echo "==> dry run: not uploading"
  exit 0
fi

# ------------------------------------------------------------------ upload
echo "==> uploading to $HOST"
headers=(-H "Content-Type: application/octet-stream" -H "X-Firmware-Signature: $(openssl base64 -A -in "$WORK/image.sig")")
if [ -n "${SCANCART_BYPASS:-}" ]; then
  headers+=(-H "x-vercel-protection-bypass: $SCANCART_BYPASS")
fi
status=$(curl -sS -o "$WORK/response.json" -w '%{http_code}' -X POST \
  "${headers[@]}" --data-binary @"$IMAGE" "$HOST/api/v1/firmware/releases") || fail "upload failed"
cat "$WORK/response.json"; echo
case "$status" in
  201) echo "==> uploaded as a draft. Nobody receives it until it is published (docs/firmware-ota.md)." ;;
  409) fail "the server already has $VERSION for $BUILD/$HW -- bump FIRMWARE_VERSION" ;;
  *) fail "server answered $status" ;;
esac

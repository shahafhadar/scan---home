# Device protocol (v1)

Unchanged from the prototype, so the existing ESP32 firmware talks to this
server as is. Only the host changes (and it is HTTPS now).

## Signing

Every call except `register` carries:

| Header | Value |
|---|---|
| `X-Device-Id` | device serial |
| `X-Timestamp` | unix seconds |
| `X-Signature` | hex `HMAC-SHA256(key = sha256_hex(secret), msg = "<timestamp>.<raw body>")` |

The secret is minted on the device (with the hardware RNG enabled) and never
leaves it; the server stores only its sha256. Requests more than 300 s off the
server clock are refused. A resend inside that window is harmless because
scans are deduplicated by `scan_id`.

## Calls

| Call | Body | Reply |
|---|---|---|
| `POST /api/v1/devices/register` (unsigned) | `{serial, secret_hash, firmware_version?, pairing_code?, claim_token?}` | `201` new / `200` known: `{pairing_code, status, claimed}` |
| `GET /api/v1/devices/claim-status` | – | `{claimed, status, pairing_code?}` |
| `POST /api/v1/scans` | `{scan_id, barcode, symbology?, ts?, queued?, quantity?}` | `200 {scan_id, status: added\|bumped\|duplicate, name, identified, quantity}` or `202 {status: held}` before pairing |
| `POST /api/v1/scans/batch` | `{scans: [scan, …≤100]}` | `{results, accepted: [scan_id…]}` – delete from the queue only what is in `accepted` |
| `POST /api/v1/devices/heartbeat` | telemetry, see below | `{ok, claimed, command, update}` – `command` is handed over exactly once; `update` is repeated every beat while it stands |
| `POST /api/v1/devices/diagnostics` | any JSON object ≤16 KB | `{ok}` |
| `GET /api/v1/firmware/<id>.bin`, `<id>.bin.sig` | – (signed over an empty body) | the image / its DER signature, `application/octet-stream`; `404` unless built for this device's build and board |
| `POST /api/v1/firmware/releases` (unsigned; the image signature is the authorisation) | the image, `X-Firmware-Signature: <base64 DER>` | `201 {id, version, build, hw, rollout_percent: 0}` |

Every reply carries `Content-Length`; the firmware refuses a body without one.

Heartbeat fields (all optional): `fw, rssi, scanner_attached, keys_seen, uptime,
reset_reason, boot_count, safe_mode, failed_boots, ota_probation, hw, self_test,
free_heap, min_heap, queue_size, queue_failed, queue_dropped, errors,
wifi_reconnects, usb_restarts, build, ota {state, target?, rejected?, error?}`.

`update`, when present, is `{version, path, size, sha256}`: a newer signed image
for this build and board. How it is offered, installed and proved:
[`firmware-ota.md`](firmware-ota.md).

## Pairing

The code goes **app → device**: the app shows a 6-character code (20 minutes,
single use), the person types it into the device's setup page, and the device
sends it as `claim_token` when it registers. The device is paired on the server
even if the setup page has already closed. A device that registers again with
the same serial and a new secret (factory reset) goes back to unpaired with a
new code. Scans made before pairing are kept and replayed into the list.

## Trying it without hardware

```bash
SCAN_HOME_URL=https://<preview-url> npm run fake-device -- register <CODE_FROM_APP>
SCAN_HOME_URL=https://<preview-url> npm run fake-device -- burst
# preview behind Vercel deployment protection: add VERCEL_BYPASS=<Protection Bypass for Automation secret>
```

#pragma once

// Every hardware and tuning constant lives here. Nothing else in the firmware
// hard-codes a pin, a URL or a timeout.

// ---------------------------------------------------------------- server
// ./dev.sh flash writes local_config.h with the address of the machine you are
// developing on. Passing this on the command line instead means fighting three
// levels of quoting for a string literal, which is how a device ends up built
// against a host that is subtly not what you typed.
#if __has_include("local_config.h")
#include "local_config.h"
#endif

#ifndef SCANCART_HOST
// Production default. Must be HTTPS with a certificate from a public CA: the
// root in certs.h is what the device checks, so a self-signed server fails.
#define SCANCART_HOST "https://api.scancart.example"
#endif

#define FIRMWARE_VERSION "1.3.0"

// The `otatest` build: an image that boots normally but never completes a
// heartbeat, so it can never pass probation and the board has to roll itself
// back. It is how the safety net is proved on real hardware, and it carries a
// version of its own so it can be offered over the real one. Never shipped.
#if defined(SCANCART_OTA_ROLLBACK_TEST)
#if defined(SCANCART_PRODUCTION)
#error "the rollback-test image must never be a production build"
#endif
#undef FIRMWARE_VERSION
#define FIRMWARE_VERSION_ROLLBACK_TEST "1.3.90"
#define FIRMWARE_VERSION FIRMWARE_VERSION_ROLLBACK_TEST
#endif

// The board this build expects. Reported in the heartbeat and in diagnostics,
// because the first question about any field fault is "which one is it?" --
// and a fleet with two revisions in it cannot answer that from the serial
// number alone.
#ifndef HW_REVISION
#define HW_REVISION "esp32s3-devkitc1-n16r8"
#endif

// 16MB. Checked at boot rather than assumed: the partition table runs to this
// mark, and a smaller chip fails in a way that points nowhere near flash.
#define EXPECTED_FLASH_BYTES (16u * 1024u * 1024u)

// A production build refuses to be pointed at a plain-http server.
//
// Until now this was a warning printed at boot, on a device nobody is watching
// -- which is another way of saying it was nothing. The check has to happen
// where someone is still looking at the screen, so it happens at compile time.
#if defined(SCANCART_PRODUCTION) && defined(__cplusplus)
constexpr bool scancartHostIsHttps(const char *host) {
  return host[0] == 'h' && host[1] == 't' && host[2] == 't' && host[3] == 'p' &&
         host[4] == 's' && host[5] == ':';
}
static_assert(scancartHostIsHttps(SCANCART_HOST),
              "a production build must point at an https host -- delete "
              "firmware/src/local_config.h, or build a development target");
#endif

// SCANCART_BYPASS (local_config.h only) lets a development build reach a
// protected Vercel preview. A shipped device must never carry it.
#if defined(SCANCART_PRODUCTION) && defined(SCANCART_BYPASS)
#error "SCANCART_BYPASS is for development builds only -- delete firmware/src/local_config.h"
#endif

// ---------------------------------------------------------------- pins
// GPIO19/20 are wired to the S3's USB PHY inside the chip. They cannot be
// moved, and nothing else may use them.
#define PIN_USB_DMINUS 19
#define PIN_USB_DPLUS  20

// UART scanner (the GM65-class modules). Scanner TX -> ESP RX.
#define PIN_SCANNER_RX 17
#define PIN_SCANNER_TX 18
#define SCANNER_BAUD   9600

#define PIN_BUZZER     21
#define PIN_LED        48   // DevKitC-1 has an addressable RGB LED here.
#define PIN_FACTORY_RESET 0 // The onboard BOOT button.

// ---------------------------------------------------------------- behaviour
// A scanner can emit the same code twice in one trigger pull. Anything inside
// this window is the same physical scan.
#define SCAN_DEBOUNCE_MS 500


#define QUEUE_MAX_ENTRIES 500
#define QUEUE_FILE "/queue.jsonl"
#define QUEUE_TEMP_FILE "/queue.tmp"

#define HEARTBEAT_INTERVAL_MS 60000
#define CLAIM_POLL_INTERVAL_MS 5000
#define HTTP_TIMEOUT_MS 10000

// Backoff between retries, in seconds. Caps out rather than growing forever,
// because a device that has been offline all night must come back promptly.
#define RETRY_BACKOFF_START_S 2
#define RETRY_BACKOFF_MAX_S 60

#define WIFI_CONNECT_TIMEOUT_MS 20000
#define WIFI_MAX_ATTEMPTS 3

#define FACTORY_RESET_HOLD_MS 10000

// Bluetooth LE scanner. The same BOOT button: held at least PAIR_HOLD and
// released before PAIR_MAX_HOLD starts pairing a scanner; released later does
// nothing (the person was heading for a reset and changed their mind); held to
// FACTORY_RESET_HOLD wipes the device as before.
#define SCANNER_PAIR_HOLD_MS 3000
#define SCANNER_PAIR_MAX_HOLD_MS 8000
#define SCANNER_PAIR_WINDOW_MS 60000
#define SCANNER_BLE_CONNECT_TIMEOUT_MS 4000

// ---------------------------------------------------------------- resilience
// Generous on purpose. A watchdog that fires during a slow but legitimate
// operation -- a first-boot filesystem format, a sluggish DNS lookup -- teaches
// everyone to switch it off, and then it protects nothing.
#define WATCHDOG_TIMEOUT_S 30

// Debug output costs serial bandwidth and CPU on a device nobody is watching,
// so production is quieter by default. `log_level` from the server raises it
// again on one misbehaving device without shipping a build.
#if defined(SCANCART_PRODUCTION)
#define LOG_DEFAULT_LEVEL Log::Level::Warn
#else
#define LOG_DEFAULT_LEVEL Log::Level::Info
#endif

// Boots that never reached a healthy state before the device gives up and
// comes back with almost nothing running.
#define SAFE_MODE_FAILED_BOOTS 5

// How long a boot must run, and reach the server, before it counts as healthy.
// Short enough to clear quickly, long enough that firmware which crashes after
// a minute is never mistaken for firmware that works.
#define HEALTHY_AFTER_MS 120000

// The scanner is expected to be present. Gone this long means something is
// wrong with it, not with the person.
#define SCANNER_MISSING_BEFORE_RESTART_MS 30000
#define SCANNER_RESTART_MAX_BACKOFF_S 300

#define HEALTH_SAMPLE_INTERVAL_MS 10000
// One "[power]" line per window (platform/Power.h): what the cores, the radio
// and the heap were doing. Five minutes smooths over single requests.
#define POWER_REPORT_INTERVAL_MS 300000
#define HEALTH_WARN_INTERVAL_MS 300000
#define HEAP_CRITICAL_BYTES 40000
#define HEAP_MIN_BLOCK_BYTES 16000

// Formatting a fresh 8MB filesystem takes a while. Past this we stop waiting
// and run without a queue rather than looking hung forever.
#define STORAGE_INIT_TIMEOUT_MS 60000

#define WIFI_RETRY_FIRST_S 1
#define WIFI_RETRY_MAX_S 60
#define SERVER_RETRY_FIRST_S 2
#define SERVER_RETRY_MAX_S 60

// A queue entry the server refuses this many times is never going to be
// accepted. Kept, marked, and taken out of the rotation.
#define QUEUE_MAX_RETRIES 10

// ---------------------------------------------------------------- ota
// How long a freshly installed image must run, and how many exchanges with the
// server it must complete, before it is trusted. Five minutes is past the
// point where the common failures show up: a bad certificate, a crash on the
// first heartbeat, a configuration that does not survive contact with WiFi.
#define OTA_PROBATION_MS 300000
#define OTA_PROBATION_CONTACTS 3

// And the deadline. An image that has neither proved nor crashed by now is
// broken in some quieter way; the device rolls itself back rather than waiting
// for someone to notice.
#define OTA_PROBATION_GIVEUP_MS 900000

// One read of a firmware download may wait this long for bytes -- covers a
// stream that opens and then goes quiet, not only the connection. Under the
// watchdog's 30s, so a stalled server ends the attempt instead of the board.
#define OTA_HTTP_TIMEOUT_MS 20000

// The size of one application slot (partitions.csv). An offer bigger than this
// cannot be installed, so it is refused before a byte is downloaded.
#define OTA_SLOT_BYTES 0x400000u

// Updates install by themselves, but only into a quiet moment: this long since
// the last scan. Long enough that someone unpacking shopping is not cut off
// mid-bag, short enough that a device on a counter updates within the hour.
#define OTA_QUIET_AFTER_SCAN_MS 120000u

// After a failed attempt: wait this long, then this, then this for every
// attempt after. A broken release must not keep the radio busy all day.
#define OTA_RETRY_FIRST_MS 120000u
#define OTA_RETRY_SECOND_MS 600000u
#define OTA_RETRY_LONG_MS 21600000u

// Which build this image is. The server only offers an image built the same
// way: a UART-scanner board must never be handed the USB build, and a
// development board must never be handed production's.
#ifndef SCANCART_BUILD
#if defined(SCANCART_PRODUCTION)
#define SCANCART_BUILD "production"
#elif defined(SCANNER_USB_HID)
#define SCANCART_BUILD "usb"
#elif defined(SCANNER_UART)
#define SCANCART_BUILD "uart"
#else
#define SCANCART_BUILD "serial"
#endif
#endif

// ---------------------------------------------------------------- limits
// The most we will read from a server response. Every reply we expect is a few
// hundred bytes; anything larger is a fault or an attack, and reading it into
// a String on a device with 300KB of heap is how the device dies.
#define MAX_RESPONSE_BYTES 4096

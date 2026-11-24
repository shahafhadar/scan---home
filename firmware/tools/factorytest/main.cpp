/**
 * Factory test — the check a person runs on a board before it is packed.
 *
 * Separate from the product build on purpose. The device's own self-test runs
 * at boot and covers what software can decide alone; this covers what it
 * cannot. Nothing here can tell whether the buzzer is audible or the LED is
 * the right colour, so those steps ask the person and wait for an answer.
 *
 *   ./dev.sh pio run -e factorytest -t upload -t monitor
 *
 * Prints PASS or FAIL per step and a verdict at the end. A board that fails
 * any step should not be packed -- every one of these faults is far cheaper
 * to find here than in someone's kitchen.
 */
#include <Arduino.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <WiFi.h>
#include <esp_flash.h>

#include "platform/config.h"

namespace {

int failures = 0;
int step = 0;

void report(const char *what, bool ok, const char *detail = "") {
  Serial.printf("%2d. %-28s %s  %s\n", ++step, what, ok ? "PASS" : "FAIL", detail);
  if (!ok) failures++;
}

/** Waits for y or n on the serial line. Anything else is asked again. */
bool ask(const char *question) {
  Serial.printf("    %s [y/n] ", question);
  Serial.flush();
  while (true) {
    while (!Serial.available()) delay(20);
    const char answer = Serial.read();
    if (answer == 'y' || answer == 'Y') { Serial.println("y"); return true; }
    if (answer == 'n' || answer == 'N') { Serial.println("n"); return false; }
  }
}

void testFlash() {
  uint32_t size = 0;
  const bool ok = esp_flash_get_size(nullptr, &size) == ESP_OK && size >= EXPECTED_FLASH_BYTES;
  char detail[48];
  snprintf(detail, sizeof(detail), "%uMB", static_cast<unsigned>(size / 1024 / 1024));
  report("flash size", ok, detail);
}

void testPsram() {
  const size_t size = ESP.getPsramSize();
  char detail[48];
  snprintf(detail, sizeof(detail), "%uMB", static_cast<unsigned>(size / 1024 / 1024));
  report("psram", size > 0, detail);
}

void testNvs() {
  Preferences prefs;
  bool ok = prefs.begin("factory", false);
  if (ok) {
    prefs.putULong("probe", 0xC0FFEE);
    ok = prefs.getULong("probe", 0) == 0xC0FFEE;
    prefs.remove("probe");
    prefs.end();
  }
  report("nvs read/write", ok);
}

void testFilesystem() {
  // Formatting here is safe and deliberate: this is a factory board with
  // nothing on it yet, and a filesystem that cannot be created is a fault.
  bool ok = LittleFS.begin(true, "/littlefs", 10, "littlefs");
  if (ok) {
    File file = LittleFS.open("/factory.probe", "w");
    ok = file && file.print("probe") == 5;
    if (file) file.close();
    LittleFS.remove("/factory.probe");
  }
  char detail[48] = "";
  if (ok) snprintf(detail, sizeof(detail), "%uKB free", static_cast<unsigned>((LittleFS.totalBytes() - LittleFS.usedBytes()) / 1024));
  report("filesystem", ok, detail);
}

void testWifi() {
  // Scanning proves the radio and the antenna without needing credentials, so
  // the same test works on any production line anywhere.
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  const int found = WiFi.scanNetworks();
  char detail[48];
  snprintf(detail, sizeof(detail), "%d network(s)", found);
  report("wifi radio", found > 0, detail);
}

void testLed() {
  Serial.println("    watch the LED: red, then green, then blue");
  const uint8_t colours[3][3] = {{60, 0, 0}, {0, 60, 0}, {0, 0, 60}};
  for (const auto &colour : colours) {
    rgbLedWrite(PIN_LED, colour[0], colour[1], colour[2]);
    delay(700);
  }
  rgbLedWrite(PIN_LED, 0, 0, 0);
  report("led", ask("did it show all three colours?"));
}

void testBuzzer() {
  Serial.println("    listen for two short beeps");
  for (int i = 0; i < 2; i++) {
    tone(PIN_BUZZER, 2000, 120);
    delay(300);
  }
  noTone(PIN_BUZZER);
  report("buzzer", ask("did you hear two beeps?"));
}

void testButton() {
  Serial.println("    press and release the BOOT button (20s)");
  pinMode(PIN_FACTORY_RESET, INPUT_PULLUP);
  const uint32_t deadline = millis() + 20000;
  bool pressed = false;
  while (millis() < deadline) {
    if (digitalRead(PIN_FACTORY_RESET) == LOW) { pressed = true; break; }
    delay(20);
  }
  report("boot button", pressed, pressed ? "" : "no press seen");
  while (digitalRead(PIN_FACTORY_RESET) == LOW) delay(20);
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println();
  Serial.println("=========================================");
  Serial.printf("ScanCart factory test — %s\n", HW_REVISION);
  Serial.printf("firmware %s, built %s %s\n", FIRMWARE_VERSION, __DATE__, __TIME__);
  Serial.println("=========================================");
  Serial.println();

  testFlash();
  testPsram();
  testNvs();
  testFilesystem();
  testWifi();
  testLed();
  testBuzzer();
  testButton();

  Serial.println();
  if (failures == 0) {
    Serial.println("VERDICT: PASS — this board may be packed");
    rgbLedWrite(PIN_LED, 0, 80, 0);
  } else {
    Serial.printf("VERDICT: FAIL — %d step(s) failed. Do not pack this board.\n", failures);
    rgbLedWrite(PIN_LED, 80, 0, 0);
  }
}

void loop() { delay(1000); }

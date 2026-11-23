#include "platform/config.h"
#include "scan/UartScanner.h"

void UartScanner::begin() {
  Serial1.begin(SCANNER_BAUD, SERIAL_8N1, PIN_SCANNER_RX, PIN_SCANNER_TX);
}

bool UartScanner::poll(String &barcode) {
  // Terminators, non-printable noise and overlong lines are LineAssembler's
  // job, shared with the Bluetooth scanner and tested on the host.
  while (Serial1.available()) {
    if (line_.push(static_cast<char>(Serial1.read()), millis())) {
      barcode = line_.take();
      return true;
    }
  }
  return false;
}

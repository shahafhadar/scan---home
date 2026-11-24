#pragma once
#include "scan/ScanSource.h"

#if defined(SCANNER_BLE)
#include <NimBLEDevice.h>
#include <freertos/FreeRTOS.h>
#include <freertos/stream_buffer.h>

#include "scan/LineAssembler.h"

/**
 * A Bluetooth LE barcode scanner -- the HBA-W7 / TD-W7 in its "Bluetooth BLE"
 * mode, measured with tools/blescan (docs/hardware-setup.md):
 *
 *   advert   "BARCODE SCANNER", service 0xAF30, fixed public address
 *   GATT     service 0xAE30, barcode text + CR as a notify on 0xAE02
 *   security none -- no pairing, no encryption
 *
 * It is not a keyboard, so nothing here decodes key presses: notifications are
 * text, and LineAssembler turns them into barcodes.
 *
 * "Pairing" therefore means remembering which scanner is ours. The board only
 * ever connects to the address it stored, so a neighbour's identical scanner
 * is never picked up by accident. A new scanner is adopted only in pairing
 * mode -- started from the BOOT button or the app -- and the nearest one that
 * shows up wins. The address survives a reboot and is wiped by factory reset.
 *
 * Reconnecting is the part a person notices. The scanner sleeps after a
 * minute idle and drops the link; the trigger that wakes it is usually also a
 * scan. So while a scanner is remembered and not connected, the radio holds a
 * standing connection request for exactly that address: the controller
 * connects on the first advert it hears, with no scan-then-connect round trip.
 * The scanner's GATT layout is kept across connections (same scanner, same
 * handles), so a reconnect only re-enables notifications -- no discovery.
 *
 * Threads: NimBLE calls back on its own host task. Those callbacks only record
 * what happened (bytes into a stream buffer, flags); subscribing and every
 * decision run from poll(), on the main loop, so no blocking BLE call is ever
 * made from inside the stack.
 */
class BleScanner : public ScanSource {
 public:
  void begin() override;
  bool poll(String &barcode) override;
  const char *name() const override { return "ble"; }

  bool attached() const override { return connected_; }
  uint32_t keysSeen() const override { return bytes_; }
  uint32_t restarts() const override { return reconnects_; }

  /** Looks for a new scanner to adopt for SCANNER_PAIR_WINDOW_MS. */
  void startPairing();
  bool pairing() const { return phase_ == Phase::Pairing; }
  /** Whether a scanner is remembered (connected or not). */
  bool paired() const { return hasSaved_; }

  /** Forgets the remembered scanner and drops the connection. */
  void forgetScanner();

  /**
   * Shuts Bluetooth down completely: link, standing request, controller and
   * host. Frees the ~95KB the stack holds and gives WiFi the whole radio --
   * what a firmware download needs. The remembered scanner is kept.
   */
  void suspend();
  /** Starts Bluetooth again after suspend(). Reconnects to the same scanner. */
  void resume();

  /**
   * Time spent waiting for the scanner and linked to it since the last call,
   * out of `totalMs`. Resets. For the power report.
   */
  void takeShares(uint32_t &waitingMs, uint32_t &linkedMs, uint32_t &totalMs);
  /** While waiting, the share of time the radio actually listens. */
  unsigned listenPercent() const;
  /** Clears the stored scanner without touching the radio. Factory reset. */
  static void eraseStored();

 private:
  enum class Phase { Off, Idle, Waiting, Pairing, Connected };

  class ScanEvents : public NimBLEScanCallbacks {
   public:
    explicit ScanEvents(BleScanner &owner) : owner_(owner) {}
    void onResult(const NimBLEAdvertisedDevice *device) override;
   private:
    BleScanner &owner_;
  };

  class ClientEvents : public NimBLEClientCallbacks {
   public:
    explicit ClientEvents(BleScanner &owner) : owner_(owner) {}
    void onConnect(NimBLEClient *client) override;
    void onConnectFail(NimBLEClient *client, int reason) override;
    void onDisconnect(NimBLEClient *client, int reason) override;
   private:
    BleScanner &owner_;
  };

  // Waiting: the standing connection request to the remembered scanner.
  void armReconnect();
  void disarmReconnect();
  // Pairing: an active scan, then a fresh connection with full discovery.
  void startScan();
  void stopScan();
  bool connectFresh(const NimBLEAddress &address);
  // Both: turn on barcode notifications on a link that is up.
  bool subscribe();

  void onData(const uint8_t *data, size_t length);
  void loadSaved();
  void save(const NimBLEAddress &address);
  bool looksLikeOurKind(const NimBLEAdvertisedDevice *device) const;
  void finishPairing(bool ok);
  void enterWaiting();

  // Read by the scan callback on the NimBLE task.
  volatile Phase phase_ = Phase::Off;
  ScanEvents scanEvents_{*this};
  ClientEvents clientEvents_{*this};
  NimBLEClient *client_ = nullptr;
  StreamBufferHandle_t stream_ = nullptr;
  LineAssembler line_;

  NimBLEAddress saved_;
  bool hasSaved_ = false;

  // Set on the NimBLE task, read on the loop. A spinlock guards the address;
  // the flags are single words.
  portMUX_TYPE mux_ = portMUX_INITIALIZER_UNLOCKED;
  volatile bool candidateSeen_ = false;  // pairing: some scanner is advertising
  NimBLEAddress candidate_;
  int candidateRssi_ = -127;
  uint32_t candidateFirstAt_ = 0;
  volatile bool linkUp_ = false;         // the standing request connected
  volatile bool connectFailed_ = false;  // ...or gave up (timeout, cancel)
  volatile bool disconnected_ = false;
  volatile int disconnectReason_ = 0;
  volatile uint32_t linkUpAt_ = 0;

  bool reconnectArmed_ = false;
  bool suspended_ = false;
  uint32_t shareAt_ = 0;
  uint32_t waitingMs_ = 0;
  uint32_t linkedMs_ = 0;
  uint32_t sharedMs_ = 0;
  bool refreshAttributes_ = false;  // rediscover on the next connect (cache suspect)
  volatile bool connected_ = false;
  volatile uint32_t bytes_ = 0;
  uint32_t loggedBytes_ = 0;
  uint32_t reconnects_ = 0;
  uint32_t droppedAt_ = 0;
  uint32_t pairUntil_ = 0;
  uint32_t retryAt_ = 0;
};
#endif

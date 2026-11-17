#pragma once
#include <Arduino.h>

/**
 * Scans that could not be sent yet.
 *
 * Kept on the filesystem rather than in RAM: the most likely reason a scan is
 * still waiting is that something is wrong with the power or the network in
 * the house, and both of those end in the device rebooting. A queue that does
 * not survive a reboot is a queue that loses exactly the scans it existed to
 * protect.
 *
 * One JSON object per line. Append to add, rewrite to remove -- at a few
 * hundred short lines that is far cheaper than any structure that would need
 * its own crash recovery.
 */
namespace ScanQueue {

enum class Status : uint8_t {
  Pending = 0,  // waiting for a chance to send
  Failed = 1,   // refused enough times that we have stopped trying
};

struct Entry {
  String scanId;
  String barcode;
  uint32_t timestamp = 0;    // when the person scanned it
  uint8_t quantity = 1;
  uint32_t lastAttempt = 0;  // uptime ms of the last try, 0 if never tried
  uint16_t retries = 0;
  Status status = Status::Pending;
};

/** Returns false when storage could not be opened; the caller carries on. */
bool begin();

bool push(const Entry &entry);

/** Up to `max` pending entries, oldest first. Failed ones are skipped. */
size_t peek(Entry *out, size_t max);

/** Drops what the server confirmed. */
void removeConfirmed(const String *scanIds, size_t count);

/**
 * Records that these were tried and refused.
 *
 * Past QUEUE_MAX_RETRIES an entry is marked Failed and stops being offered.
 * Without this a single scan the server will never accept is retried forever,
 * riding along in every batch and keeping the device awake for nothing.
 */
void recordFailure(const String *scanIds, size_t count);

size_t size();         // pending only
size_t failedCount();
bool isEmpty();
void clear();

/** Entries dropped because the queue was full. Reported, not silent. */
uint32_t droppedCount();

}  // namespace ScanQueue

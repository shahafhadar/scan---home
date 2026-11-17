#pragma once
#include <Arduino.h>

/**
 * Backoff, in one place, without sleeping.
 *
 * The old code had three separate backoff implementations, each built from
 * delay() -- which meant the device stopped answering the button, the LED and
 * the scanner for up to a minute at a time. This holds a deadline instead:
 * callers ask "may I try yet?" and get on with their loop if the answer is no.
 *
 *   RetryPolicy wifi(1, 60);
 *   if (wifi.ready()) {
 *     if (connect()) wifi.succeeded();
 *     else           wifi.failed();
 *   }
 */
class RetryPolicy {
 public:
  RetryPolicy(uint32_t firstDelaySeconds, uint32_t maxDelaySeconds, uint16_t maxAttempts = 0)
      : first_(firstDelaySeconds), max_(maxDelaySeconds), maxAttempts_(maxAttempts),
        current_(firstDelaySeconds) {}

  /** True when the backoff has elapsed and another attempt is allowed. */
  bool ready() const {
    if (exhausted()) return false;
    return nextAttemptAt_ == 0 || millis() >= nextAttemptAt_;
  }

  void succeeded() {
    attempts_ = 0;
    current_ = first_;
    nextAttemptAt_ = 0;
  }

  void failed() {
    attempts_++;
    nextAttemptAt_ = millis() + current_ * 1000UL;
    // Doubling, capped. Uncapped growth means a device that recovers after an
    // hour-long outage waits another hour before noticing.
    current_ = min(current_ * 2, max_);
  }

  /** Only meaningful when a maximum was set; otherwise it retries forever. */
  bool exhausted() const { return maxAttempts_ > 0 && attempts_ >= maxAttempts_; }

  uint16_t attempts() const { return attempts_; }
  uint32_t currentDelaySeconds() const { return current_; }

  uint32_t secondsUntilReady() const {
    if (nextAttemptAt_ == 0 || millis() >= nextAttemptAt_) return 0;
    return (nextAttemptAt_ - millis()) / 1000;
  }

  void reset() {
    attempts_ = 0;
    current_ = first_;
    nextAttemptAt_ = 0;
  }

 private:
  uint32_t first_;
  uint32_t max_;
  uint16_t maxAttempts_;
  uint32_t current_;
  uint16_t attempts_ = 0;
  uint32_t nextAttemptAt_ = 0;
};

#include "hmi/Feedback.h"

#include "platform/config.h"

namespace {

Feedback::State state_ = Feedback::State::Booting;

// A queue of tones, played out by tick() so nothing ever blocks.
struct Tone {
  uint16_t frequency;
  uint16_t durationMs;
};
constexpr uint8_t kMaxTones = 8;
Tone tones_[kMaxTones];
uint8_t toneCount_ = 0;
uint8_t tonePlaying_ = 0;
uint32_t toneStartedAt_ = 0;
bool toneActive_ = false;

// "Locate" overrides the LED for a fixed window; it never changes state_, so
// the normal colour is exactly what comes back afterwards.
constexpr uint32_t kLocateMs = 4000;
uint32_t locateUntil_ = 0;

void queueTone(uint16_t frequency, uint16_t durationMs) {
  if (toneCount_ >= kMaxTones) return;
  tones_[toneCount_++] = {frequency, durationMs};
}

struct Rgb { uint8_t r, g, b; };

Rgb colorFor(Feedback::State state) {
  switch (state) {
    case Feedback::State::Booting:       return {40, 40, 40};
    case Feedback::State::Provisioning:  return {0, 40, 255};
    case Feedback::State::Connecting:    return {0, 80, 200};
    case Feedback::State::WaitingToPair: return {150, 0, 255};
    case Feedback::State::Ready:         return {0, 180, 40};
    case Feedback::State::Queued:        return {255, 140, 0};
    case Feedback::State::Error:         return {255, 0, 0};
    case Feedback::State::Updating:      return {255, 0, 200};
  }
  return {0, 0, 0};
}

bool breathes(Feedback::State state) {
  return state == Feedback::State::Provisioning || state == Feedback::State::WaitingToPair ||
         state == Feedback::State::Connecting || state == Feedback::State::Updating;
}

}  // namespace

namespace Feedback {

void begin() {
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);
  setState(State::Booting);
}

void setState(State state) { state_ = state; }

void tick() {
  const uint32_t now = millis();

  // --- buzzer -------------------------------------------------------------
  if (toneActive_) {
    if (now - toneStartedAt_ >= tones_[tonePlaying_].durationMs) {
      noTone(PIN_BUZZER);
      toneActive_ = false;
      tonePlaying_++;
      if (tonePlaying_ >= toneCount_) {
        toneCount_ = 0;
        tonePlaying_ = 0;
      }
    }
  } else if (tonePlaying_ < toneCount_) {
    const Tone &next = tones_[tonePlaying_];
    if (next.frequency > 0) tone(PIN_BUZZER, next.frequency);
    toneStartedAt_ = now;
    toneActive_ = true;
  }

  // --- LED ----------------------------------------------------------------
  // tick() runs every pass of the main loop, which is hundreds of times a
  // second. Driving the LED that often is wasted work, and it used to emit a
  // deprecation warning on every call -- roughly ninety lines a second, enough
  // to bury every useful message on the console.
  static uint32_t lastPaint = 0;
  static uint8_t lastR = 255, lastG = 255, lastB = 255;
  if (now - lastPaint < 25) return;
  lastPaint = now;

  if (now < locateUntil_) {
    // A fast, unmistakable strobe -- nothing else here blinks this quickly.
    const bool on = (now / 120) % 2 == 0;
    const uint8_t level = on ? 255 : 0;
    if (level != lastR) { lastR = lastG = lastB = level; rgbLedWrite(PIN_LED, level, level, level); }
    return;
  }

  const Rgb base = colorFor(state_);
  uint8_t level = 255;
  if (breathes(state_)) {
    // A slow triangle wave reads as "working on it" rather than "faulty",
    // which a hard blink does.
    const uint32_t phase = now % 2000;
    const uint32_t up = phase < 1000 ? phase : 2000 - phase;
    level = static_cast<uint8_t>(40 + (up * 215) / 1000);
  }

  const uint8_t r = (base.r * level) / 255;
  const uint8_t g = (base.g * level) / 255;
  const uint8_t b = (base.b * level) / 255;
  if (r == lastR && g == lastG && b == lastB) return;
  lastR = r; lastG = g; lastB = b;

  rgbLedWrite(PIN_LED, r, g, b);
}

void beepAccepted() { queueTone(2400, 60); }

void beepUnknown() {
  // Two notes, second one lower: recognisably "got it, but I do not know it".
  queueTone(2400, 60);
  queueTone(0, 40);
  queueTone(1400, 90);
}

void beepQueued() {
  queueTone(1800, 50);
  queueTone(0, 30);
  queueTone(1800, 50);
}

void beepError() { queueTone(700, 250); }

void beepPaired() {
  queueTone(1600, 90);
  queueTone(2000, 90);
  queueTone(2600, 140);
}

void flashLocate() {
  locateUntil_ = millis() + kLocateMs;
  queueTone(2000, 120);
  queueTone(0, 80);
  queueTone(2400, 120);
  queueTone(0, 80);
  queueTone(2800, 160);
}

}  // namespace Feedback

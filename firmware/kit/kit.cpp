#include "kit.h"

#include "ht16k33.h"
#include "radio.h"
#include "rgb_panel.h"

namespace kit {

namespace {

constexpr uint32_t kPollMs  = 20;  // ~ the HT16K33 key-scan period
constexpr uint32_t kFlushMs = 20;
// Held = seen in any of the last N reads. Key registers clear on read,
// so a held button alternates 1/0/1/0; 3 reads (~60 ms) bridges that.
constexpr uint8_t  kHoldReads = 3;

uint8_t  g_want[kCells]  = {};
uint8_t  g_shown[kCells] = {};
bool     g_forceFlush    = true;
uint32_t g_lastFlushMs   = 0;

uint32_t g_lastPollMs = 0;
uint16_t g_recent[kHoldReads] = {};
uint8_t  g_recentIdx  = 0;
uint16_t g_held       = 0;
uint16_t g_pressed    = 0;

uint8_t  g_boards = 1;

// Raw key read → 9-bit mask in reading order. Wiring quirks found by
// experiment on this board: KS0/KS1 are swapped (KS0 = middle row) and
// K1..K3 run right-to-left.
uint16_t readVisual() {
  uint8_t raw[6] = {0};
  if (!ht16k33::readKeys(raw)) return 0;
  static const uint8_t kKsToRow[3] = {1, 0, 2};
  uint16_t mask = 0;
  for (uint8_t ks = 0; ks < 3; ks++) {
    const uint8_t byte = raw[ks * 2] & 0x07;
    for (uint8_t k = 0; k < 3; k++) {
      if (byte & (1 << k)) mask |= (uint16_t)1u << (kKsToRow[ks] * 3 + (2 - k));
    }
  }
  return mask;
}

}  // namespace

namespace internal {

void setup(uint8_t boards) {
  g_boards = boards < 1 ? 1 : (boards > 2 ? 2 : boards);
  for (uint8_t i = 0; i < kCells; i++) g_want[i] = g_shown[i] = OFF;
  g_forceFlush = true;
}

void poll() {
  g_pressed = 0;
  const uint32_t now = millis();
  if (now - g_lastPollMs < kPollMs) return;
  g_lastPollMs = now;

  g_recent[g_recentIdx] = readVisual();
  g_recentIdx = (g_recentIdx + 1) % kHoldReads;

  uint16_t held = 0;
  for (uint8_t i = 0; i < kHoldReads; i++) held |= g_recent[i];
  g_pressed = held & ~g_held;
  g_held    = held;
}

void flush() {
  const uint32_t now = millis();
  if (!g_forceFlush && now - g_lastFlushMs < kFlushMs) return;
  g_lastFlushMs = now;
  for (uint8_t i = 0; i < kCells; i++) {
    if (!g_forceFlush && g_want[i] == g_shown[i]) continue;
    const uint8_t c = g_want[i];
    rgb_panel::setLed(i, c & RED, c & GREEN, c & BLUE);
    g_shown[i] = c;
  }
  g_forceFlush = false;
}

uint16_t sampleHeld(uint32_t forMs) {
  uint16_t seen = 0;
  const uint32_t start = millis();
  while (millis() - start < forMs) {
    seen |= readVisual();
    delay(kPollMs);
  }
  return seen;
}

}  // namespace internal

void set(uint8_t cell, uint8_t colour) {
  if (cell < kCells) g_want[cell] = colour & WHITE;
}
uint8_t get(uint8_t cell) { return cell < kCells ? g_want[cell] : OFF; }
void fill(uint8_t colour) {
  for (uint8_t i = 0; i < kCells; i++) g_want[i] = colour & WHITE;
}
void clear() { fill(OFF); }

uint16_t held() { return g_held; }
uint16_t pressed() { return g_pressed; }
bool isHeld(uint8_t cell) { return cell < kCells && (g_held & (1u << cell)); }
bool wasPressed(uint8_t cell) { return cell < kCells && (g_pressed & (1u << cell)); }
uint8_t firstPressed() {
  for (uint8_t i = 0; i < kCells; i++) {
    if (g_pressed & (1u << i)) return i;
  }
  return kNone;
}

uint8_t boardCount() { return g_boards; }
bool peerConnected() { return g_boards > 1 && radio::peerConnected(); }
uint8_t me() { return g_boards > 1 ? radio::me() : 0; }
bool send(const void *data, uint8_t len) {
  return g_boards > 1 && radio::send(data, len);
}
uint8_t receive(void *buf, uint8_t bufSize) {
  return g_boards > 1 ? radio::receive(buf, bufSize) : 0;
}

}  // namespace kit

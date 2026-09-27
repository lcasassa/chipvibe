// The game kit: everything a chipvibe game is allowed to touch.
//
// The board is a 3×3 grid of RGB LEDs; every LED is also a button.
// Cells are numbered in reading order, as seen from the front:
//
//     0 1 2
//     3 4 5        cell n = LED n = button n
//     6 7 8
//
// Why a kit instead of the raw drivers: the HT16K33 has two quirks that
// break naive games.
//   * Its key registers clear on read, so a held button reads as
//     press / nothing / press / …  — the kit smooths that.
//   * Too many I²C transactions freeze its key scan (buttons stop after
//     the first press) — the kit reads keys at most every 20 ms and only
//     rewrites LEDs whose colour actually changed.
#pragma once
#include <Arduino.h>

namespace kit {

constexpr uint8_t kCells = 9;

// Each colour channel is on or off, so there are exactly 8 colours.
enum : uint8_t {
  OFF     = 0,
  RED     = 1,
  GREEN   = 2,
  YELLOW  = 3,  // red + green
  BLUE    = 4,
  MAGENTA = 5,  // red + blue
  CYAN    = 6,  // green + blue
  WHITE   = 7,
};

// ── LEDs ───────────────────────────────────────────────────────────
void set(uint8_t cell, uint8_t colour);  // out-of-range cells are ignored
uint8_t get(uint8_t cell);
void fill(uint8_t colour);
void clear();

// ── Buttons (bit n set = cell n) ───────────────────────────────────
uint16_t held();      // being held down now
uint16_t pressed();   // went down since the last tick — each press once
bool isHeld(uint8_t cell);
bool wasPressed(uint8_t cell);
constexpr uint8_t kNone = 0xFF;
uint8_t firstPressed();  // lowest cell pressed since last tick, or kNone

// ── Two boards (only meaningful when the game uses 2 grids) ────────
// Both boards run the same game. They find each other over the radio.
uint8_t boardCount();     // how many grids this game was made for (1 or 2)
bool peerConnected();     // the other board has been heard recently
uint8_t me();             // 0 or 1: which board this is. Stable once the
                          // peer is connected (decided by radio address);
                          // 0 while waiting.
constexpr uint8_t kMaxMessage = 32;
// Send up to kMaxMessage bytes to the other board. Fire-and-forget:
// messages can be lost, so resend state rather than one-off events.
// Returns false if the message was too big or the radio isn't up.
bool send(const void *data, uint8_t len);
// Pop the next message from the other board. Returns its length (1..32)
// and copies it into buf, or 0 if nothing is waiting.
uint8_t receive(void *buf, uint8_t bufSize);

// ── Used by main.cpp, not by games ─────────────────────────────────
namespace internal {
void setup(uint8_t boards);
void poll();
void flush();
uint16_t sampleHeld(uint32_t forMs);
}  // namespace internal

}  // namespace kit

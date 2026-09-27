#include "rgb_panel.h"

#include "ht16k33.h"

namespace rgb_panel {

namespace {

// LED index → (COM digit, R-bit, G-bit, B-bit) in the 16-bit display word.
//
// LED index = physical button position (0=top-left, 8=bottom-right).
//
// Rows  (COMs are tic-tac-toe rows):
//   - COM1 = middle row (LEDs 3,4,5)
//   - COM2 = top row    (LEDs 0,1,2)   ← swapped vs COM1, same as KS0/KS1 button swap
//   - COM3 = bottom row (LEDs 6,7,8)
//
// Columns (each column reuses the same 3 ROWs across all 3 COMs):
//   - col 0 → ROWs {8, 9, 12}
//   - col 1 → ROWs {7, 10, 13}
//   - col 2 → ROWs {6, 11, 14}
//
// Per-LED colour assignment, deduced from per-row green/blue/red probes
// then cross-checked against every observation (all 36 step×LED data
// points match):
//   - Green is on the column's middle ROW for cols 1/2, and on the high
//     ROW (12) for col 0.
//   - Top-row LEDs put R on the low ROW, B on the high ROW (col 0 pattern).
//   - Middle/bottom-row LEDs swap R and B vs the top row.
//   - Two LEDs (LED1 and LED4 in col 1, LED2 and LED8 in col 2) leave
//     R↔B observationally indistinguishable; the assignment below assumes
//     the same swap pattern as col 0. If a colour shows up wrong on those
//     LEDs, swap their R and B ROW arguments below.

struct LedMap {
  uint8_t  com;
  uint16_t rBit, gBit, bBit, mask;
};

constexpr LedMap makeLedRGB(uint8_t com, uint8_t rRow, uint8_t gRow, uint8_t bRow) {
  return {com,
          static_cast<uint16_t>(1u << rRow),
          static_cast<uint16_t>(1u << gRow),
          static_cast<uint16_t>(1u << bRow),
          static_cast<uint16_t>((1u << rRow) | (1u << gRow) | (1u << bRow))};
}

//                            COM   R    G    B
constexpr LedMap kMap[9] = {
  makeLedRGB(2,  8, 12,  9),  // LED0: top row,    col 0
  makeLedRGB(2, 13, 10,  7),  // LED1: top row,    col 1   (R/B swapped per board)
  makeLedRGB(2,  6, 11, 14),  // LED2: top row,    col 2   (R/G guess)
  makeLedRGB(1,  9, 12,  8),  // LED3: middle row, col 0
  makeLedRGB(1, 13, 10,  7),  // LED4: middle row, col 1   (R/B guess)
  makeLedRGB(1, 14, 11,  6),  // LED5: middle row, col 2
  makeLedRGB(3,  9, 12,  8),  // LED6: bottom row, col 0
  makeLedRGB(3,  7, 10, 13),  // LED7: bottom row, col 1   (R/B swapped per board)
  makeLedRGB(3, 14, 11,  6),  // LED8: bottom row, col 2   (R/B guess)
};

}  // namespace

const uint8_t kNumLeds = 9;

void setLed(uint8_t idx, bool r, bool g, bool b) {
  if (idx >= 9) return;
  const auto& m = kMap[idx];
  uint16_t segs = 0;
  if (r) segs |= m.rBit;
  if (g) segs |= m.gBit;
  if (b) segs |= m.bBit;
#if RGB_ACTIVE_LOW
  segs = (~segs) & m.mask;
#endif
  ht16k33::writeDigitShadow(m.com, segs, m.mask);
}

void setAll(bool r, bool g, bool b) {
  for (uint8_t i = 0; i < 9; i++) setLed(i, r, g, b);
}

void blank() { setAll(false, false, false); }

void setBusy(uint8_t idx, bool on) { setLed(idx, on, false, false); }

void showOtaProgress(int percent) {
  if (percent <= 0)        setLed(4, false, false, false);
  else if (percent >= 100) setLed(4, false, true,  false);
  else                     setLed(4, true,  false, false);
}

}  // namespace rgb_panel


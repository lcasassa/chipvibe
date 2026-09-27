// 9 × RGB LEDs driven through the HT16K33 14-seg backpack for tic-tac-toe.
//
// HT16K33 pin naming (28-SOP):
//   COM0/AD  COM1/KS0  COM2/KS1  COM3/KS2
//   ROW0/A2  ROW1/A1   ROW2/A0
//   ROW3/K1  ROW4/K2   ROW5/K3   ROW6/K4  ROW7/K5  ROW8/K6
//   ROW9/K7  ROW10/K8  ROW11/K9  ROW12/K10 ROW13/K11 ROW14/K12
//
// Buttons (9): K1–K3 (ROW3–5) × KS0–KS2 (COM1–3).
// LEDs avoid ROW3–5 so button K1–K3 reads are clean.
//
// LEDs (9): 3 per COM on COM1–COM3, using ROW6–ROW14:
//   COM1: LED0 (ROW6/7/8)   LED1 (ROW9/10/11)  LED2 (ROW12/13/14)
//   COM2: LED3 (ROW6/7/8)   LED4 (ROW9/10/11)  LED5 (ROW12/13/14)
//   COM3: LED6 (ROW6/7/8)   LED7 (ROW9/10/11)  LED8 (ROW12/13/14)
//
// Total wires: 3 COM (COM1–3) + 12 ROW (ROW3–14) = 15.
//
// Set RGB_ACTIVE_LOW=1 if using common-anode LEDs.
#pragma once

#include <Arduino.h>

#ifndef RGB_ACTIVE_LOW
#define RGB_ACTIVE_LOW 0
#endif

namespace rgb_panel {

// Number of LEDs on the board.
extern const uint8_t kNumLeds;  // 9

// Set a single LED (0–8) to the given R/G/B.
void setLed(uint8_t ledIndex, bool r, bool g, bool b);

// Set all 9 LEDs to the same colour.
void setAll(bool r, bool g, bool b);

// All LEDs off.
void blank();

// "Busy" indicator on a single LED.
void setBusy(uint8_t ledIndex, bool on);

// OTA progress mapped onto LED 4 (centre of the board).
void showOtaProgress(int percent);

}  // namespace rgb_panel


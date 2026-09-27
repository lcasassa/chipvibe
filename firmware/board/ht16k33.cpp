#include "ht16k33.h"

#include <Wire.h>

namespace ht16k33 {

namespace {
constexpr uint8_t kSysOn       = 0x21;  // oscillator on
constexpr uint8_t kDisplayOn   = 0x81;  // display on, no blink
constexpr uint8_t kDimmingBase = 0xE0;  // | brightness 0..15
constexpr uint8_t kRowIntSet   = 0xA0;  // ROW/INT set register

// Per-digit shadow shared by every writer.
uint16_t g_shadow[8] = {0};
}  // namespace

void cmd(uint8_t c) {
  Wire.beginTransmission(kAddr);
  Wire.write(c);
  Wire.endTransmission();
}

void fillAll(uint8_t v) {
  Wire.beginTransmission(kAddr);
  Wire.write(0x00);
  for (uint8_t i = 0; i < 16; i++) Wire.write(v);
  Wire.endTransmission();
  for (uint8_t d = 0; d < 8; d++) {
    g_shadow[d] = (uint16_t)v | ((uint16_t)v << 8);
  }
}

void writeDigit(uint8_t digit, uint16_t segs) {
  Wire.beginTransmission(kAddr);
  Wire.write((uint8_t)(digit * 2));
  Wire.write((uint8_t)(segs & 0xFF));
  Wire.write((uint8_t)((segs >> 8) & 0xFF));
  Wire.endTransmission();
}

void writeDigitShadow(uint8_t digit, uint16_t segs, uint16_t mask) {
  g_shadow[digit] = (g_shadow[digit] & ~mask) | (segs & mask);
  writeDigit(digit, g_shadow[digit]);
}

void setup() {
  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setClock(400000);  // HT16K33 supports up to 400 kHz
  cmd(kSysOn);
  cmd(kDimmingBase | 2);
  cmd(kDisplayOn);
  cmd(kRowIntSet);     // enable ROW driver for key scanning
  fillAll(0x00);
  Serial.println("HT16K33: setup done");
}

bool readKeys(uint8_t out[6]) {
  Wire.beginTransmission(kAddr);
  Wire.write(0x40);  // key-data register start
  if (Wire.endTransmission() != 0) return false;
  uint8_t n = Wire.requestFrom(kAddr, (uint8_t)6);
  if (n != 6) return false;
  for (uint8_t i = 0; i < 6; i++) out[i] = Wire.read();
  return true;
}

uint16_t readButtons3x3() {
  // Key data register layout (HT16K33 datasheet):
  //
  //   Byte 0 (0x40): K1–K8 × KS0   (bits 0–7 = K1..K8 vs COM1/KS0)
  //   Byte 1 (0x41): K9–K12 × KS0  (bits 0–3)
  //   Byte 2 (0x42): K1–K8 × KS1   (COM2/KS1)
  //   Byte 3 (0x43): K9–K12 × KS1
  //   Byte 4 (0x44): K1–K8 × KS2   (COM3/KS2)
  //   Byte 5 (0x45): K9–K12 × KS2
  //
  // Buttons: K1–K3 (ROW3–5) × KS0–KS2 (COM1–3) = 9 buttons.
  // LEDs use K4–K12 (ROW6–14) so they cause phantom reads only on
  // bits 3–7 of each KS byte — we mask to bits 0–2 (K1–K3) only.
  //
  //   KS0 (COM1): buttons 0,1,2  (K1,K2,K3)
  //   KS1 (COM2): buttons 3,4,5  (K1,K2,K3)
  //   KS2 (COM3): buttons 6,7,8  (K1,K2,K3)
  uint8_t raw[6];
  if (!readKeys(raw)) return 0;

  uint16_t mask = 0;
  for (uint8_t ks = 0; ks < 3; ks++) {
    uint8_t byte = raw[ks * 2] & 0x07;  // bits 0–2 = K1–K3 only
    for (uint8_t k = 0; k < 3; k++) {
      if (byte & (1 << k)) {
        mask |= (1 << (ks * 3 + k));
      }
    }
  }
  return mask;
}

}  // namespace ht16k33



// chipvibe firmware entry point.
//
// The game is whatever the studio staged into firmware/current/:
//   game_info.h — GAME_SLUG, GAME_NAME, GAME_BOARDS (1 or 2)
//   game.h      — gameSetup() + gameTick(), written against kit.h
// Both are plain #includes, so PlatformIO notices when they change.
//
// Boot:
//   1. LEDs + key scan up, quick R/G/B flash.
//   2. Held at power-on:
//        top-left  (cell 0) → open WiFi setup hotspot "chipvibe-xxxx"
//        top-right (cell 2) → download this game's latest build from GitHub
//   3. WiFi in the background (if set up); OTA arms itself when connected.
//   4. For 2-board games, the radio link to the other board starts.
//
// The board never updates from GitHub unless top-right is held, so a
// game flashed over USB can't be silently replaced.

#include <Arduino.h>
#include <WiFi.h>

#include "game_info.h"
#include "ht16k33.h"
#include "kit.h"
#include "radio.h"
#include "net.h"
#include "rgb_panel.h"

#ifndef ONBOARD_LED_PIN
#define ONBOARD_LED_PIN 8
#endif

namespace {
#include "game.h"
}  // namespace

namespace {

constexpr uint16_t kChordWifiSetup = 1u << 0;  // top-left
constexpr uint16_t kChordGithub    = 1u << 2;  // top-right

void bootFlash() {
  const bool seq[3][3] = {{true, false, false}, {false, true, false}, {false, false, true}};
  for (const auto &c : seq) {
    rgb_panel::setAll(c[0], c[1], c[2]);
    delay(150);
  }
  rgb_panel::blank();
}

void flashAll(bool r, bool g, bool b) {
  for (uint8_t i = 0; i < 3; i++) {
    rgb_panel::setAll(r, g, b);
    delay(200);
    rgb_panel::blank();
    delay(150);
  }
}

void githubUpdate() {
  Serial.println("boot: GitHub update requested");
  rgb_panel::blank();
  rgb_panel::setLed(2, true, false, true);  // magenta: checking
  if (!net::connectWifi(30000)) {
    Serial.println("boot: no WiFi — hold top-left at power-on to set it up");
    flashAll(true, false, false);
    return;
  }
  // Reboots into the new build if there is one.
  const bool upToDate = net::updateFromGithub();
  flashAll(!upToDate, upToDate, false);  // green = up to date, red = failed
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.printf("\n=== chipvibe: %s (%s), %d board(s) ===\n", GAME_NAME, GAME_SLUG, GAME_BOARDS);

  pinMode(ONBOARD_LED_PIN, OUTPUT);
  digitalWrite(ONBOARD_LED_PIN, HIGH);  // active-low: off
  ht16k33::setup();
  kit::internal::setup(GAME_BOARDS);
  bootFlash();

  const uint16_t chord = kit::internal::sampleHeld(300);
  if (chord & kChordWifiSetup) {
    net::runSetupHotspot();
  } else if (chord & kChordGithub) {
    githubUpdate();
  }

  net::beginWifi();
  Serial.printf("boot: I am %s\n", net::name());
  if (GAME_BOARDS > 1) radio::setup();

  rgb_panel::blank();
  gameSetup();
  kit::internal::flush();
}

void loop() {
  net::handleOta();
  if (net::otaInProgress) return;  // LEDs show upload progress
  net::maintain();
  if (GAME_BOARDS > 1) radio::tick();

  kit::internal::poll();
  gameTick();
  kit::internal::flush();

  // Yield so the idle task can run; a tight loop starves WiFi and the
  // chip runs hot (learned on the tic-tac-toe firmware).
  delay(2);
}

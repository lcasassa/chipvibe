// Radio link between two grids running the same game (ESP-NOW).
//
// Both boards broadcast a small "hello" ten times a second and any game
// messages. The two find each other without pairing:
//   * A board on WiFi stays on its WiFi channel (it has to).
//   * A board NOT on WiFi that hasn't heard its peer for a while hops
//     through channels 1–13 until it does, then follows the peer's
//     channel. So "one board on WiFi, one not" still works; "both on
//     WiFi" works if they're on the same network.
// Which board is 0 and which is 1 is decided by comparing radio (MAC)
// addresses, so both boards agree without talking about it.
#pragma once
#include <Arduino.h>

namespace radio {

void setup();           // call after WiFi is in STA mode
void tick();            // call every loop
bool peerConnected();
uint8_t me();           // 0 until the peer is known
bool send(const void *data, uint8_t len);
uint8_t receive(void *buf, uint8_t bufSize);

}  // namespace radio

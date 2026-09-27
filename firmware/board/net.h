// WiFi, ArduinoOTA and the GitHub updater for chipvibe boards.
//
// Adapted from f1_lights/esp32-tictactoe/wifi_ota.cpp. The main change:
// every board names itself from its radio address — "chipvibe-a1b2" —
// so two boards on one network never clash, and the studio can list
// them (they advertise _arduino._tcp over mDNS once OTA is armed).
#pragma once
#include <Arduino.h>

namespace net {

// "chipvibe-xxxx" — hotspot name, mDNS name and OTA name.
const char *name();

extern volatile bool otaInProgress;
extern bool inSetupHotspot;

bool hasSavedWifi();
void beginWifi();              // non-blocking; no-op without saved WiFi
bool connectWifi(uint32_t timeoutMs);
void maintain();               // call every loop: arms OTA once connected
void runSetupHotspot();        // blocks up to 5 min; open hotspot = name()
void handleOta();
// Download this game's latest build from GitHub if it differs from the
// running one; reboots on success. Returns true if already up to date.
bool updateFromGithub();

}  // namespace net

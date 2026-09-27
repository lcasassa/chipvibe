#include "net.h"

#include <ArduinoOTA.h>
#include <ESPmDNS.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiManager.h>
#include <esp_wifi.h>

#include "game_info.h"
#include "rgb_panel.h"

// Set by CI: -DFIRMWARE_VERSION=\"<slug>@<sha>\". Local builds are "dev",
// so holding top-right on a locally flashed board always fetches the
// published build of the same game.
#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "dev"
#endif
#ifndef CHIPVIBE_REPO
#define CHIPVIBE_REPO "lcasassa/chipvibe"
#endif
// LAN-only OTA password. Public on purpose (the repo is public); it only
// stops accidental cross-flashing, it is not a security boundary.
#ifndef CHIPVIBE_OTA_PASSWORD
#define CHIPVIBE_OTA_PASSWORD "chipvibe"
#endif

// Each game publishes to its own release: game-<slug>.
#define RELEASE_BASE "https://github.com/" CHIPVIBE_REPO "/releases/download/game-" GAME_SLUG "/"

namespace net {

volatile bool otaInProgress = false;
bool inSetupHotspot = false;

namespace {
char g_name[20] = "chipvibe";
bool g_otaArmed = false;
int8_t g_saved = -1;  // -1 unknown, 0 no saved WiFi, 1 saved

void ensureName() {
  static bool done = false;
  if (done) return;
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  snprintf(g_name, sizeof(g_name), "chipvibe-%02x%02x", mac[4], mac[5]);
  done = true;
}

void staMode() {
  ensureName();
  WiFi.persistent(true);
  WiFi.mode(WIFI_STA);
  WiFi.setHostname(g_name);
}

void armOta() {
  ArduinoOTA.setHostname(g_name);
  ArduinoOTA.setPassword(CHIPVIBE_OTA_PASSWORD);
  ArduinoOTA
      .onStart([]() {
        otaInProgress = true;
        Serial.println("OTA: start");
        rgb_panel::blank();
        rgb_panel::showOtaProgress(1);
      })
      .onEnd([]() {
        Serial.println("OTA: done");
        rgb_panel::showOtaProgress(100);
        otaInProgress = false;
      })
      .onProgress([](unsigned int p, unsigned int t) {
        if (t) rgb_panel::showOtaProgress((int)((uint64_t)p * 100 / t));
      })
      .onError([](ota_error_t e) {
        otaInProgress = false;
        Serial.printf("OTA error %u\n", e);
      });
  ArduinoOTA.begin();
  Serial.printf("OTA: ready at %s.local (%s)\n", g_name, WiFi.localIP().toString().c_str());
}
}  // namespace

const char *name() {
  ensureName();
  return g_name;
}

bool hasSavedWifi() {
  // Read once; the WiFi mode is only set here and in the hotspot.
  if (g_saved < 0) {
    staMode();
    wifi_config_t conf;
    g_saved = (esp_wifi_get_config(WIFI_IF_STA, &conf) == ESP_OK && conf.sta.ssid[0]) ? 1 : 0;
  }
  return g_saved == 1;
}

void beginWifi() {
  if (!hasSavedWifi()) {
    Serial.println("WiFi: not set up (hold top-left at power-on)");
    return;
  }
  WiFi.begin();
  Serial.println("WiFi: connecting in the background");
}

bool connectWifi(uint32_t timeoutMs) {
  if (!hasSavedWifi()) return false;
  WiFi.begin();
  const uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - start > timeoutMs) return false;
    delay(200);
  }
  return true;
}

void maintain() {
  if (inSetupHotspot) return;
  if (WiFi.status() == WL_CONNECTED) {
    if (!g_otaArmed) {
      armOta();
      g_otaArmed = true;
    }
    return;
  }
  if (!hasSavedWifi()) return;
  // Retry occasionally if the network is set up but unreachable. Kept
  // slow on purpose: each attempt scans channels, which briefly
  // interrupts the radio link between two boards.
  static uint32_t s_lastTry = 0;
  const uint32_t now = millis();
  if (now - s_lastTry > 30000) {
    s_lastTry = now;
    WiFi.reconnect();
  }
}

void runSetupHotspot() {
  staMode();
  Serial.printf("WiFi: setup hotspot '%s' open — visit http://192.168.4.1/\n", g_name);
  rgb_panel::setAll(false, false, true);  // solid blue while the hotspot is up
  inSetupHotspot = true;
  WiFiManager wm;
  wm.setHostname(g_name);
  wm.setConfigPortalTimeout(300);
  wm.setConnectTimeout(30);
  wm.setBreakAfterConfig(true);
  const bool ok = wm.startConfigPortal(g_name);  // open network: kid-friendly
  inSetupHotspot = false;
  rgb_panel::blank();
  if (!ok) {
    Serial.println("WiFi: setup timed out, restarting");
    delay(200);
    ESP.restart();
  }
  g_saved = 1;
  Serial.printf("WiFi: set up, IP=%s\n", WiFi.localIP().toString().c_str());
}

void handleOta() {
  if (g_otaArmed) ArduinoOTA.handle();
}

bool updateFromGithub() {
  WiFiClientSecure client;
  client.setInsecure();  // GitHub's cert chain rotates; integrity = HTTPS + version check
  client.setTimeout(15);

  HTTPClient http;
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  if (!http.begin(client, RELEASE_BASE "version.txt")) return false;
  const int code = http.GET();
  String latest = code == HTTP_CODE_OK ? http.getString() : String();
  http.end();
  latest.trim();
  Serial.printf("GitHub: running '%s', published '%s' (HTTP %d)\n", FIRMWARE_VERSION,
                latest.c_str(), code);
  if (latest.isEmpty()) return false;
  if (latest == FIRMWARE_VERSION) return true;

  httpUpdate.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
  httpUpdate.rebootOnUpdate(true);
  httpUpdate.onProgress([](int cur, int total) {
    if (total > 0) rgb_panel::showOtaProgress((int)((int64_t)cur * 100 / total));
  });
  const t_httpUpdate_return r = httpUpdate.update(client, RELEASE_BASE "firmware.bin");
  Serial.printf("GitHub: update result %d (%s)\n", (int)r,
                httpUpdate.getLastErrorString().c_str());
  return false;  // on success we never get here: the board reboots
}

}  // namespace net

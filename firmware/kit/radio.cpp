#include "radio.h"

#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <string.h>

#include "kit.h"

namespace radio {

namespace {

constexpr uint32_t kMagic        = 0x43564C31;  // 'CVL1'
constexpr uint8_t  kKindHello    = 0;
constexpr uint8_t  kKindData     = 1;
constexpr uint32_t kHelloMs      = 100;
constexpr uint32_t kStaleMs      = 1500;
constexpr uint32_t kHuntAfterMs  = 2000;  // silence before a WiFi-less board hops
constexpr uint32_t kHopMs        = 250;
constexpr uint8_t  kQueueLen     = 8;

struct __attribute__((packed)) Packet {
  uint32_t magic;
  uint8_t  kind;
  uint8_t  channel;  // sender's current channel, so a hunter can follow
  uint8_t  len;
  uint8_t  data[kit::kMaxMessage];
};

struct Msg {
  uint8_t len;
  uint8_t data[kit::kMaxMessage];
};

const uint8_t kBroadcast[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

bool     g_up = false;
uint8_t  g_myMac[6] = {};
uint8_t  g_peerMac[6] = {};
volatile bool     g_peerKnown = false;
volatile uint32_t g_lastRxMs  = 0;
volatile uint8_t  g_followChannel = 0;  // set by the rx callback, applied in tick()

Msg      g_queue[kQueueLen];
volatile uint8_t g_qHead = 0, g_qCount = 0;
portMUX_TYPE g_mux = portMUX_INITIALIZER_UNLOCKED;

uint32_t g_lastHelloMs = 0;
uint32_t g_lastHopMs   = 0;

uint8_t currentChannel() {
  uint8_t pri = 1;
  wifi_second_chan_t sec = WIFI_SECOND_CHAN_NONE;
  esp_wifi_get_channel(&pri, &sec);
  return pri;
}

void handlePacket(const uint8_t *mac, const uint8_t *data, int len) {
  if (!mac || len < (int)offsetof(Packet, data)) return;
  const Packet *p = reinterpret_cast<const Packet *>(data);
  if (p->magic != kMagic) return;
  if (memcmp(mac, g_myMac, 6) == 0) return;  // our own echo

  portENTER_CRITICAL(&g_mux);
  // First board heard becomes the peer; ignore strangers after that so
  // a third board in the room can't hijack a running game.
  if (!g_peerKnown) {
    memcpy(g_peerMac, mac, 6);
    g_peerKnown = true;
  }
  const bool fromPeer = memcmp(mac, g_peerMac, 6) == 0;
  if (fromPeer) {
    g_lastRxMs = millis();
    g_followChannel = p->channel;
    if (p->kind == kKindData && p->len >= 1 && p->len <= kit::kMaxMessage &&
        len >= (int)(offsetof(Packet, data) + p->len) && g_qCount < kQueueLen) {
      Msg &m = g_queue[(g_qHead + g_qCount) % kQueueLen];
      m.len = p->len;
      memcpy(m.data, p->data, p->len);
      g_qCount++;
    }
  }
  portEXIT_CRITICAL(&g_mux);
}

#if ESP_IDF_VERSION_MAJOR >= 5
void onRecv(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
  handlePacket(info ? info->src_addr : nullptr, data, len);
}
#else
void onRecv(const uint8_t *mac, const uint8_t *data, int len) { handlePacket(mac, data, len); }
#endif

bool sendPacket(uint8_t kind, const void *data, uint8_t len) {
  if (!g_up) return false;
  Packet p;
  p.magic   = kMagic;
  p.kind    = kind;
  p.channel = currentChannel();
  p.len     = len;
  if (len) memcpy(p.data, data, len);
  return esp_now_send(kBroadcast, reinterpret_cast<const uint8_t *>(&p),
                      offsetof(Packet, data) + len) == ESP_OK;
}

}  // namespace

void setup() {
  if (WiFi.getMode() == WIFI_OFF) WiFi.mode(WIFI_STA);
  // Radio power-save off: otherwise the station sleeps between AP
  // beacons and ESP-NOW packets arriving in those gaps are dropped.
  esp_wifi_set_ps(WIFI_PS_NONE);
  WiFi.setSleep(false);
  esp_read_mac(g_myMac, ESP_MAC_WIFI_STA);

  if (esp_now_init() != ESP_OK) {
    Serial.println("radio: esp_now_init failed");
    return;
  }
  esp_now_register_recv_cb(onRecv);
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, kBroadcast, 6);
  peer.channel = 0;  // follow the current channel
  peer.encrypt = false;
  peer.ifidx   = WIFI_IF_STA;
  g_up = esp_now_add_peer(&peer) == ESP_OK;
  Serial.printf("radio: %s on channel %u\n", g_up ? "up" : "FAILED", currentChannel());
}

void tick() {
  if (!g_up) return;
  const uint32_t now = millis();
  const bool onWifi = WiFi.status() == WL_CONNECTED;

  if (now - g_lastHelloMs >= kHelloMs) {
    g_lastHelloMs = now;
    sendPacket(kKindHello, nullptr, 0);
  }

  if (onWifi) return;  // a WiFi station must stay on its AP's channel

  const uint8_t follow = g_followChannel;
  if (follow >= 1 && follow <= 13 && follow != currentChannel()) {
    esp_wifi_set_channel(follow, WIFI_SECOND_CHAN_NONE);
  }
  if (!peerConnected() && now - g_lastRxMs > kHuntAfterMs && now - g_lastHopMs >= kHopMs) {
    g_lastHopMs = now;
    const uint8_t next = currentChannel() % 13 + 1;
    esp_wifi_set_channel(next, WIFI_SECOND_CHAN_NONE);
  }
}

bool peerConnected() {
  return g_peerKnown && g_lastRxMs != 0 && millis() - g_lastRxMs <= kStaleMs;
}

uint8_t me() {
  if (!g_peerKnown) return 0;
  return memcmp(g_myMac, g_peerMac, 6) < 0 ? 0 : 1;
}

bool send(const void *data, uint8_t len) {
  if (!data || len == 0 || len > kit::kMaxMessage) return false;
  return sendPacket(kKindData, data, len);
}

uint8_t receive(void *buf, uint8_t bufSize) {
  uint8_t n = 0;
  portENTER_CRITICAL(&g_mux);
  if (g_qCount) {
    const Msg &m = g_queue[g_qHead];
    n = m.len <= bufSize ? m.len : bufSize;
    memcpy(buf, m.data, n);
    g_qHead = (g_qHead + 1) % kQueueLen;
    g_qCount--;
  }
  portEXIT_CRITICAL(&g_mux);
  return n;
}

}  // namespace radio

// Whack a Mole: hit the green light before it disappears! Sometimes two moles at once.

enum : uint8_t { STATE_PLAYING, STATE_MISS, STATE_GAMEOVER };

static const uint16_t kTimeoutStart = 2200;
static const uint16_t kTimeoutMin = 500;
static const uint16_t kTimeoutStep = 150;
static const uint16_t kMissFlashMs = 600;
static const uint16_t kBlinkMs = 200;
static const uint8_t kMissLimit = 3;
static const uint8_t kMaxMoles = 2;

static uint8_t s_state;
static uint8_t s_moleCells[kMaxMoles];
static bool s_moleActive[kMaxMoles];
static uint8_t s_moleCount;
static unsigned long s_moleStart;
static unsigned long s_stateStart;
static unsigned long s_lastBlink;
static bool s_blinkOn;
static uint8_t s_hits;
static uint8_t s_misses;

static uint16_t currentTimeout() {
  uint16_t t = kTimeoutStart;
  uint16_t drop = (uint16_t)s_hits * kTimeoutStep;
  if (drop >= t - kTimeoutMin) return kTimeoutMin;
  return t - drop;
}

static void spawnMoles() {
  kit::clear();

  uint8_t twoChance = 10 + s_hits * 5;
  if (twoChance > 50) twoChance = 50;
  s_moleCount = (s_hits >= 2 && (uint8_t)random(100) < twoChance) ? 2 : 1;

  for (uint8_t i = 0; i < s_moleCount; i++) {
    uint8_t cell;
    bool dup;
    do {
      cell = random(kit::kCells);
      dup = false;
      for (uint8_t j = 0; j < i; j++) {
        if (s_moleCells[j] == cell) dup = true;
      }
    } while (dup);
    s_moleCells[i] = cell;
    s_moleActive[i] = true;
    kit::set(cell, kit::GREEN);
  }

  s_moleStart = millis();
  s_state = STATE_PLAYING;
}

static void startMiss() {
  s_state = STATE_MISS;
  s_stateStart = millis();
  s_lastBlink = s_stateStart;
  s_blinkOn = true;
  kit::fill(kit::RED);
}

static void startGameOver() {
  s_state = STATE_GAMEOVER;
  s_lastBlink = millis();
  s_blinkOn = true;
  kit::fill(kit::RED);
}

void gameSetup() {
  randomSeed(micros());
  s_hits = 0;
  s_misses = 0;
  spawnMoles();
}

void gameTick() {
  unsigned long now = millis();

  if (s_state == STATE_PLAYING) {
    uint16_t p = kit::pressed();

    if (p != 0) {
      bool wrong = false;
      for (uint8_t c = 0; c < kit::kCells; c++) {
        if (!(p & (1u << c))) continue;
        bool isMole = false;
        for (uint8_t i = 0; i < s_moleCount; i++) {
          if (s_moleActive[i] && s_moleCells[i] == c) {
            s_moleActive[i] = false;
            kit::set(c, kit::OFF);
            isMole = true;
          }
        }
        if (!isMole) wrong = true;
      }

      if (wrong) {
        s_misses++;
        if (s_misses >= kMissLimit) startGameOver();
        else startMiss();
        return;
      }

      bool anyActive = false;
      for (uint8_t i = 0; i < s_moleCount; i++) {
        if (s_moleActive[i]) anyActive = true;
      }
      if (!anyActive) {
        s_hits++;
        spawnMoles();
      }
      return;
    }

    bool anyActive = false;
    for (uint8_t i = 0; i < s_moleCount; i++) {
      if (s_moleActive[i]) anyActive = true;
    }
    if (anyActive && now - s_moleStart > currentTimeout()) {
      s_misses++;
      if (s_misses >= kMissLimit) startGameOver();
      else startMiss();
    }
    return;
  }

  if (s_state == STATE_MISS) {
    if (now - s_lastBlink > kBlinkMs) {
      s_lastBlink = now;
      s_blinkOn = !s_blinkOn;
      if (s_blinkOn) kit::fill(kit::RED);
      else kit::clear();
    }
    if (now - s_stateStart > kMissFlashMs) spawnMoles();
    return;
  }

  // STATE_GAMEOVER
  if (now - s_lastBlink > kBlinkMs) {
    s_lastBlink = now;
    s_blinkOn = !s_blinkOn;
    if (s_blinkOn) kit::fill(kit::RED);
    else kit::clear();
  }
  if (kit::pressed() != 0) {
    s_hits = 0;
    s_misses = 0;
    spawnMoles();
  }
}

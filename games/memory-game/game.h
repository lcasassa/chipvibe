// Memory match game: find the 4 matching colour pairs among the 9 lights.
// One colour is alone with no pair. Wrong guesses flash red once.
// Finding all pairs flashes the whole board green, then a new round begins.

static const uint8_t kPalette[7] = {
  kit::RED, kit::GREEN, kit::BLUE, kit::YELLOW, kit::MAGENTA, kit::CYAN, kit::WHITE
};

static const uint8_t CELL_HIDDEN = 0;
static const uint8_t CELL_REVEALED = 1;
static const uint8_t CELL_SOLVED = 2;

static const uint8_t PHASE_PLAY = 0;
static const uint8_t PHASE_CHECK = 1;
static const uint8_t PHASE_WRONG = 2;
static const uint8_t PHASE_WIN = 3;

static uint8_t s_color[kit::kCells];
static uint8_t s_state[kit::kCells];
static int8_t s_first;
static int8_t s_second;
static uint8_t s_phase;
static unsigned long s_timer;
static uint8_t s_pairsFound;

static unsigned long s_heartbeatTimer;
static int8_t s_heartbeatCell;
static bool s_heartbeatOn;

static void shuffleArray(uint8_t* arr, uint8_t n) {
  for (uint8_t i = n - 1; i > 0; i--) {
    uint8_t j = random(i + 1);
    uint8_t t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
}

static void startNewRound() {
  uint8_t pool[7] = {kPalette[0], kPalette[1], kPalette[2], kPalette[3], kPalette[4], kPalette[5], kPalette[6]};
  shuffleArray(pool, 7);

  uint8_t assign[9];
  assign[0] = pool[0];
  assign[1] = pool[1]; assign[2] = pool[1];
  assign[3] = pool[2]; assign[4] = pool[2];
  assign[5] = pool[3]; assign[6] = pool[3];
  assign[7] = pool[4]; assign[8] = pool[4];
  shuffleArray(assign, 9);

  for (uint8_t i = 0; i < kit::kCells; i++) {
    s_color[i] = assign[i];
    s_state[i] = CELL_HIDDEN;
    kit::set(i, kit::OFF);
  }
  s_first = -1;
  s_second = -1;
  s_pairsFound = 0;
  s_phase = PHASE_PLAY;
  s_heartbeatOn = false;
  s_heartbeatCell = -1;
  s_heartbeatTimer = millis();
}

void gameSetup() {
  randomSeed(micros());
  startNewRound();
}

void gameTick() {
  unsigned long now = millis();

  if (s_phase == PHASE_CHECK) {
    if (now - s_timer >= 700) {
      if (s_color[s_first] == s_color[s_second]) {
        s_state[s_first] = CELL_SOLVED;
        s_state[s_second] = CELL_SOLVED;
        s_first = -1;
        s_second = -1;
        s_pairsFound++;
        if (s_pairsFound >= 4) {
          kit::fill(kit::GREEN);
          s_phase = PHASE_WIN;
          s_timer = now;
        } else {
          s_phase = PHASE_PLAY;
        }
      } else {
        kit::set(s_first, kit::RED);
        kit::set(s_second, kit::RED);
        s_phase = PHASE_WRONG;
        s_timer = now;
      }
    }
    return;
  }

  if (s_phase == PHASE_WRONG) {
    if (now - s_timer >= 300) {
      kit::set(s_first, kit::OFF);
      kit::set(s_second, kit::OFF);
      s_state[s_first] = CELL_HIDDEN;
      s_state[s_second] = CELL_HIDDEN;
      s_first = -1;
      s_second = -1;
      s_phase = PHASE_PLAY;
    }
    return;
  }

  if (s_phase == PHASE_WIN) {
    if (now - s_timer >= 1500) {
      startNewRound();
    }
    return;
  }

  // PHASE_PLAY: gentle heartbeat blink while waiting, so the board stays alive.
  if (s_first == -1) {
    if (s_heartbeatOn) {
      if (now - s_heartbeatTimer >= 150) {
        if (s_heartbeatCell >= 0 && s_state[s_heartbeatCell] == CELL_HIDDEN) {
          kit::set(s_heartbeatCell, kit::OFF);
        }
        s_heartbeatOn = false;
        s_heartbeatTimer = now;
      }
    } else if (now - s_heartbeatTimer >= 2500) {
      s_heartbeatCell = random(kit::kCells);
      if (s_state[s_heartbeatCell] == CELL_HIDDEN) {
        kit::set(s_heartbeatCell, kit::WHITE);
      }
      s_heartbeatOn = true;
      s_heartbeatTimer = now;
    }
  }

  uint8_t c = kit::firstPressed();
  if (c == kit::kNone) return;
  if (s_state[c] != CELL_HIDDEN) return;

  s_state[c] = CELL_REVEALED;
  kit::set(c, s_color[c]);

  if (s_first == -1) {
    s_first = c;
  } else {
    s_second = c;
    s_phase = PHASE_CHECK;
    s_timer = now;
  }
}

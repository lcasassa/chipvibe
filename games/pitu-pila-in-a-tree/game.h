// Pitu Pila in a Tree!
// Pitu Pila is GREEN. The snake is RED.
// A light blinks red = the snake is coming! Tap another light to hop away.
// Dodge 10 times to level up — then the snake gets faster.

enum State : uint8_t { WARN, STRIKE, GAP, LEVELUP, EATEN, SCORE };

static State    s_state;
static uint32_t s_timer;      // when the current state started
static uint8_t  s_pitu;       // cell where Pitu Pila is
static uint8_t  s_target;     // cell the snake is going to bite
static uint8_t  s_dodges;     // dodges this level
static uint8_t  s_level;      // 1, 2, 3...

static uint32_t warnTime() {
  int32_t t = 1300 - (int32_t)(s_level - 1) * 150;
  if (t < 300) t = 300;
  return (uint32_t)t;
}

static void startWarn(uint32_t now) {
  // The snake mostly goes for Pitu, sometimes somewhere nearby
  if (random(3) == 0) {
    s_target = random(kit::kCells);
  } else {
    s_target = s_pitu;
  }
  s_state = WARN;
  s_timer = now;
}

static void newGame(uint32_t now) {
  s_pitu = 4;
  s_dodges = 0;
  s_level = 1;
  s_state = GAP;
  s_timer = now;
}

static void movePitu() {
  uint8_t c = kit::firstPressed();
  if (c != kit::kNone) s_pitu = c;
}

void gameSetup() {
  randomSeed(micros());
  newGame(millis());
}

void gameTick() {
  uint32_t now = millis();
  uint32_t t = now - s_timer;

  switch (s_state) {
    case WARN: {
      movePitu();
      kit::clear();
      kit::set(s_pitu, kit::GREEN);
      bool blinkOn = ((t / 100) % 2) == 0;
      if (blinkOn) kit::set(s_target, kit::RED);
      if (t >= warnTime()) {
        s_state = STRIKE;
        s_timer = now;
      }
      break;
    }

    case STRIKE: {
      movePitu();
      kit::clear();
      kit::set(s_pitu, kit::GREEN);
      kit::set(s_target, kit::RED);
      if (s_pitu == s_target) {
        s_state = EATEN;          // CHOMP!
        s_timer = now;
      } else if (t >= 300) {
        s_dodges++;
        s_timer = now;
        if (s_dodges >= 10) {
          s_dodges = 0;
          s_level++;
          s_state = LEVELUP;
        } else {
          s_state = GAP;
        }
      }
      break;
    }

    case GAP: {
      movePitu();
      kit::clear();
      kit::set(s_pitu, kit::GREEN);
      if (t >= 400) startWarn(now);
      break;
    }

    case LEVELUP: {
      // Party flash: green and yellow
      bool a = ((t / 150) % 2) == 0;
      kit::fill(a ? kit::GREEN : kit::YELLOW);
      kit::wasPressed(0); // ignore taps
      if (t >= 1500) {
        s_state = GAP;
        s_timer = now;
      }
      break;
    }

    case EATEN: {
      // The snake got Pitu! Red flash
      bool a = ((t / 120) % 2) == 0;
      kit::fill(a ? kit::RED : kit::OFF);
      if (t >= 1500) {
        s_state = SCORE;
        s_timer = now;
      }
      break;
    }

    case SCORE: {
      // Show your level: one yellow light per level (blue if more than 9)
      kit::clear();
      uint8_t n = s_level > 9 ? 9 : s_level;
      uint8_t col = s_level > 9 ? kit::BLUE : kit::YELLOW;
      for (uint8_t i = 0; i < n; i++) kit::set(i, col);
      if (t >= 3000) newGame(now);
      break;
    }
  }
}

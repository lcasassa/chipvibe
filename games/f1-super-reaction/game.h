// F1 super reaction!
// 5 red lights count down, lights out -> middle goes GREEN -> tap it fast!
// Your time is shown as 3 digits after "0.": yellow, then cyan, then magenta.

enum State : uint8_t { S_COUNT, S_GO, S_RATING, S_DIGITS, S_EARLY };

static const uint8_t kStartLights[5] = {0, 1, 2, 3, 5};
static const uint8_t kDigitColour[3] = {kit::YELLOW, kit::CYAN, kit::MAGENTA};

static uint8_t  s_state;
static uint32_t s_t0;
static uint16_t s_extra;
static uint16_t s_ms;
static uint8_t  s_digit[3];

static void startRound() {
  s_state = S_COUNT;
  s_t0 = millis();
  s_extra = 200 + random(800);  // little surprise wait, like real F1
  kit::clear();
}

void gameSetup() {
  randomSeed(micros());
  startRound();
}

void gameTick() {
  uint32_t now = millis();
  uint32_t e = now - s_t0;
  bool dimOn = (now & 7) < 2;  // soft glow

  switch (s_state) {
    case S_COUNT: {
      uint8_t n = e / 1000 + 1;
      if (n > 5) n = 5;
      kit::clear();
      for (uint8_t i = 0; i < n; i++) kit::set(kStartLights[i], kit::RED);
      kit::set(4, dimOn ? kit::WHITE : kit::OFF);
      if (kit::wasPressed(4)) {
        s_state = S_EARLY;
        s_t0 = now;
      } else if (e >= 5000UL + s_extra) {
        s_state = S_GO;
        s_t0 = now;
        kit::clear();
        kit::set(4, kit::GREEN);
      }
      break;
    }

    case S_GO:
      kit::clear();
      kit::set(4, kit::GREEN);
      if (kit::wasPressed(4)) {
        s_ms = e > 999 ? 999 : e;
        s_digit[0] = s_ms / 100;
        s_digit[1] = (s_ms / 10) % 10;
        s_digit[2] = s_ms % 10;
        s_state = S_RATING;
        s_t0 = now;
      } else if (e > 3000) {
        startRound();  // nobody pressed, try again
      }
      break;

    case S_RATING: {
      uint8_t c = s_ms < 250 ? kit::GREEN : (s_ms < 400 ? kit::YELLOW : kit::RED);
      kit::fill(c);
      if (e >= 1500) {
        s_state = S_DIGITS;
        s_t0 = now;
      }
      break;
    }

    case S_DIGITS: {
      uint8_t idx = e / 1800;
      if (idx >= 3) {
        startRound();
        break;
      }
      uint16_t inSlot = e % 1800;
      if (inSlot >= 1500) {
        kit::clear();
        kit::set(4, dimOn ? kit::WHITE : kit::OFF);
      } else {
        uint8_t d = s_digit[idx];
        uint8_t c = kDigitColour[idx];
        for (uint8_t i = 0; i < kit::kCells; i++) {
          if (d == 0) kit::set(i, dimOn ? c : kit::OFF);
          else kit::set(i, i < d ? c : kit::OFF);
        }
      }
      break;
    }

    case S_EARLY:
      kit::fill(((e / 250) % 2 == 0) ? kit::RED : kit::OFF);
      if (e >= 3000) startRound();
      break;
  }
}

// Flyswatter! Swat the fly before it zooms away.
// 3 levels, 15 flies each. Flies get faster every level.

static const uint16_t kStayMs[3]   = {150, 100, 50};
static const uint8_t  kFlyColour[3] = {kit::GREEN, kit::CYAN, kit::MAGENTA};
static const uint8_t  kRainbow[]   = {kit::RED, kit::YELLOW, kit::GREEN, kit::CYAN, kit::BLUE, kit::MAGENTA};
static const uint8_t  kFliesPerLevel = 15;
static const uint8_t  kLevels = 3;

enum { PLAY, SPLAT, LEVELUP, WIN };

static uint8_t  s_state;
static uint8_t  s_level;
static uint8_t  s_kills;
static uint8_t  s_fly;
static uint8_t  s_prevFly;
static uint8_t  s_splat;
static uint32_t s_moveT;
static uint32_t s_prevT;
static uint32_t s_t;

static void moveFly(uint32_t now) {
  uint8_t c = random(kit::kCells - 1);
  if (c >= s_fly) c++;          // always jump to a different cell
  s_prevFly = s_fly;
  s_prevT = now;
  s_fly = c;
  s_moveT = now;
}

static void startLevelUp(uint32_t now) {
  s_state = LEVELUP;
  s_t = now;
}

void gameSetup() {
  randomSeed(micros());
  s_level = 0;
  s_kills = 0;
  s_fly = random(kit::kCells);
  s_prevFly = s_fly;
  startLevelUp(millis());
}

void gameTick() {
  uint32_t now = millis();
  uint16_t p = kit::pressed();

  switch (s_state) {
    case PLAY: {
      if (now - s_moveT >= kStayMs[s_level]) moveFly(now);

      // Hit the fly (with a tiny grace for the cell it just left).
      int8_t hit = -1;
      if (p & (1u << s_fly)) hit = s_fly;
      else if ((p & (1u << s_prevFly)) && now - s_prevT < 60) hit = s_prevFly;

      if (hit >= 0) {
        s_kills++;
        s_splat = hit;
        s_state = SPLAT;
        s_t = now;
        break;
      }

      kit::clear();
      kit::set(s_fly, kFlyColour[s_level]);
      break;
    }

    case SPLAT: {
      kit::clear();
      kit::set(s_splat, ((now - s_t) / 80) % 2 ? kit::YELLOW : kit::RED);
      if (now - s_t >= 400) {
        if (s_kills >= kFliesPerLevel) {
          s_kills = 0;
          s_level++;
          if (s_level >= kLevels) {
            s_state = WIN;
            s_t = now;
          } else {
            startLevelUp(now);
          }
        } else {
          moveFly(now);
          s_state = PLAY;
        }
      }
      break;
    }

    case LEVELUP: {
      // Blink as many lights as the level number.
      bool on = ((now - s_t) / 200) % 2 == 0;
      kit::clear();
      for (uint8_t i = 0; i <= s_level; i++) {
        kit::set(i, on ? kFlyColour[s_level] : kit::WHITE);
      }
      if (now - s_t >= 2000) {
        moveFly(now);
        s_state = PLAY;
      }
      break;
    }

    case WIN: {
      uint8_t shift = (now - s_t) / 120;
      for (uint8_t i = 0; i < kit::kCells; i++) {
        kit::set(i, kRainbow[(i + shift) % 6]);
      }
      if (now - s_t >= 5000) {
        s_level = 0;
        s_kills = 0;
        startLevelUp(now);
      }
      break;
    }
  }
}

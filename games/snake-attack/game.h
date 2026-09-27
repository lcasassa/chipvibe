// Snake attack! Tap a light next to the snake's head to move there.
// Eat the red apple to grow. Don't bump into your own tail!

static uint8_t s_snake[kit::kCells];
static uint8_t s_len;
static int8_t s_apple;
static uint8_t s_state;  // 0 = playing, 1 = win, 2 = lose
static uint32_t s_stateStart;

enum { PLAYING = 0, WIN = 1, LOSE = 2 };

static uint8_t cellRow(uint8_t c) { return c / 3; }
static uint8_t cellCol(uint8_t c) { return c % 3; }

static int8_t findEmptyCell() {
  for (uint8_t tries = 0; tries < 50; tries++) {
    int8_t c = random(kit::kCells);
    bool used = false;
    for (uint8_t i = 0; i < s_len; i++) {
      if (s_snake[i] == c) { used = true; break; }
    }
    if (!used) return c;
  }
  return -1;
}

static void resetGame() {
  s_len = 1;
  s_snake[0] = 4;
  s_apple = findEmptyCell();
  s_state = PLAYING;
}

static void drawBoard(uint32_t now) {
  if (s_state == PLAYING) {
    kit::clear();
    for (uint8_t i = 1; i < s_len; i++) kit::set(s_snake[i], kit::GREEN);
    bool blink = (now / 250) % 2 == 0;
    kit::set(s_snake[0], blink ? kit::WHITE : kit::GREEN);
    if (s_apple >= 0) kit::set(s_apple, kit::RED);
  } else {
    bool on = (now / 200) % 2 == 0;
    kit::fill(on ? (s_state == WIN ? kit::YELLOW : kit::RED) : kit::OFF);
  }
}

void gameSetup() {
  randomSeed(micros());
  resetGame();
  drawBoard(millis());
}

void gameTick() {
  uint32_t now = millis();

  if (s_state != PLAYING) {
    if (now - s_stateStart > 3000) resetGame();
    drawBoard(now);
    return;
  }

  uint8_t c = kit::firstPressed();
  if (c != kit::kNone) {
    uint8_t head = s_snake[0];
    int8_t dr = (int8_t)cellRow(c) - (int8_t)cellRow(head);
    int8_t dc = (int8_t)cellCol(c) - (int8_t)cellCol(head);
    if (dr < 0) dr = -dr;
    if (dc < 0) dc = -dc;

    if (dr + dc == 1) {
      bool growing = (c == s_apple);
      uint8_t checkLen = growing ? s_len : (uint8_t)(s_len - 1);
      bool blocked = false;
      for (uint8_t i = 0; i < checkLen; i++) {
        if (s_snake[i] == c) { blocked = true; break; }
      }

      if (blocked) {
        s_state = LOSE;
        s_stateStart = now;
      } else if (growing) {
        for (uint8_t i = s_len; i > 0; i--) s_snake[i] = s_snake[i - 1];
        s_snake[0] = c;
        s_len++;
        if (s_len >= kit::kCells) {
          s_state = WIN;
          s_stateStart = now;
        } else {
          s_apple = findEmptyCell();
        }
      } else {
        for (uint8_t i = s_len - 1; i > 0; i--) s_snake[i] = s_snake[i - 1];
        s_snake[0] = c;
      }
    }
  }

  drawBoard(now);
}

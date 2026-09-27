# chipvibe

Make games for a 3×3 LED button grid by chatting with an AI. Built for
kids: pick a game (or start one), describe what you want, press
**Program**, play. Keep chatting to make it better.

```sh
./start
```

That checks the tools, starts the app and opens <http://127.0.0.1:4400>.

## What you need

| Tool | For | Install |
|---|---|---|
| Node 18+ | the app | `brew install node` |
| PlatformIO | compiling + flashing | `brew install platformio` |
| Claude Code (`claude`), logged in | writing the games | <https://claude.com/claude-code> |
| GitHub CLI (`gh`), logged in | sharing (optional) | `brew install gh && gh auth login` |

## The hardware

The **LED button grid**: an ESP32-C3 Super Mini driving an HT16K33
backpack with 9 RGB LEDs in a 3×3 grid, and a button under every LED.

```
0 1 2
3 4 5      cell n = LED n = button n
6 7 8
```

Each colour channel is on/off, so there are 8 colours. A game can use
**one grid, or two grids that talk to each other over the radio**
(ESP-NOW) — e.g. tic-tac-toe across two boards. Other boards appear in
the hardware picker but aren't available yet.

### Buttons at power-on

| Hold | Does |
|---|---|
| top-left | Opens a WiFi setup hotspot `chipvibe-xxxx` (grid turns blue). Join it on a phone and pick your home network. After that, the board shows up in the app over WiFi. |
| top-right | Downloads the latest *shared and merged* version of the game it's running from GitHub (magenta while checking). |

A board only updates from GitHub when you hold top-right, so something
you flashed over USB is never silently replaced.

## Using it

- **Pick or start a game** — top bar: game switcher, **＋ New game**.
- **Hardware** — one or two grids. Click the hardware chips on a game
  to change it later.
- **Chat** — tell the AI what to make or change. It replies, rewrites
  the game, and the app **compiles it straight away**. If it doesn't
  build, the errors go back to the AI to fix (twice at most). A version
  that won't build is never saved.
- **Program** — the right panel lists every board it can find: USB
  ports, and boards already on your WiFi. Tick the ones to program; one
  build goes to all of them.
- **Share** — opens a pull request on GitHub with just this game.
- **🧠 Model** — Sonnet (default), Opus (smartest) or Haiku (fastest).
- **🪙 Tokens** — today's tokens and cost; click for totals by model and
  by game. Costs are as reported by the CLI; on a subscription you may
  not be billed per token.
- **🛠 Improve the app** — ask for changes to this app itself. See below.

## Everything is committed

Every game change is a commit in this repo, made the moment it builds
(`<game>: <what you asked>`). Nothing is lost and everything can be
undone with git.

**Share** builds a PR containing *only* that game's folder, on top of
GitHub's `main`, in a temporary worktree — other games and unshared
work never leak in. Sharing the same game again updates the same PR
(branch `game/<slug>`). If GitHub's `main` doesn't exist yet, the app's
first commit is pushed as `main` first.

CI (`.github/workflows/games.yml`) compiles every game a PR touches,
and on `main` publishes each to a `game-<slug>` release for the
top-right download.

## Improve the app from inside the app

The 🛠 drawer is a chat that edits the app's own web UI (`web/`). It's
the only place the AI can edit files, so it's fenced in:

- it runs in `web/` with file tools only — no shell, no web access;
- anything it changes outside `web/` is put back;
- every change is its own commit (`ui: …`) — **↩️ Undo** reverts the
  latest one, repeatedly;
- if a change breaks the page, go to **<http://127.0.0.1:4400/safe>** —
  an undo page served from `server/`, which the AI can't touch.

**☁️ Share app changes** opens a PR with the `web/` changes.

## How it's built

```
firmware/
  main.cpp           boot, power-on buttons, WiFi/OTA, game loop
  kit/kit.*          the only API games use: LEDs, buttons, radio
  kit/radio.*        ESP-NOW link between two grids
  board/net.*        WiFi, OTA, GitHub updater (adapted from f1_lights)
  board/ht16k33.*, rgb_panel.*   drivers (from f1_lights/esp32-tictactoe)
  current/           the staged game (generated, git-ignored)
games/<slug>/
  game.json          name, idea, hardware
  game.h             the game: gameSetup() + gameTick()
  chat.json          the conversation that built it
server/              zero-dependency Node server
web/                 the UI (plain HTML/CSS/JS, no build step)
```

**One firmware env for every game.** The server stages a game by
writing `firmware/current/game.h` + `game_info.h` (only when they
change) and runs `pio run -e board`. Flags never change, so switching
games recompiles `main.cpp`, not the framework. Builds run one at a time.

**The AI writes games with no tools.** It returns one code block; the
server extracts it, compiles it and commits it. The worst a bad reply
can do is not build.

**Why the kit exists:** the HT16K33's key registers clear on read (a
held button reads 1/0/1/0) and too much I²C traffic freezes its key
scan. The kit reads keys every 20 ms, smooths holds, reports each press
once, and only rewrites LEDs whose colour changed.

## Notes

- The server listens on `127.0.0.1` only — it runs a compiler, the
  claude CLI and git. `CHIPVIBE_HOST` / `PORT` override.
- The OTA password (`chipvibe`) is public on purpose. It prevents
  accidental cross-flashing on your LAN; it isn't a security boundary.
- WiFi flashing sends the image to `chipvibe-xxxx.local` with
  PlatformIO's `espota.py`, so one build can go to any number of boards.
- First flash of a new board must be over USB (hold BOOT, tap RST if it
  won't connect).

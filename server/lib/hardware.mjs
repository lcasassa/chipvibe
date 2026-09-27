// Hardware catalogue.
//
// Every board the family owns is listed so the picker looks the way it
// always has, but only the LED button grid can be chosen for now — it's
// the board the firmware in this repo runs on. Up to two grids can be
// combined; they talk to each other over the radio (firmware/kit/link.cpp).

export const BOARDS = [
  {
    id: 'grid',
    name: 'LED Button Grid',
    emoji: '🎮',
    available: true,
    max: 2,
    blurb: '9 colour lights in a 3×3 grid — and every light is a button.',
    pins: [
      ['Chip', 'ESP32-C3 Super Mini'],
      ['LEDs + buttons', 'HT16K33 on I²C (SDA GPIO 4, SCL GPIO 5)'],
      ['Onboard LED', 'GPIO 8 (active-low)'],
    ],
  },
  {
    id: 'screen',
    name: 'LED Matrix Screen',
    emoji: '🟥',
    available: false,
    reason: 'Coming soon',
    blurb: '16×32 colour LED screen with 4 buttons.',
    pins: [],
  },
  {
    id: 'f1',
    name: 'F1 Start Lights',
    emoji: '🏁',
    available: false,
    reason: 'Coming soon',
    blurb: '10 LEDs, two 7-segment displays, buzzer and 2 buttons.',
    pins: [],
  },
];

/** Returns { ok, error, count } for a list of board ids. */
export function validateBoards(boards) {
  if (!Array.isArray(boards) || boards.length === 0) {
    return { ok: false, error: 'Pick at least one board.' };
  }
  const unavailable = boards.find((id) => !BOARDS.find((b) => b.id === id)?.available);
  if (unavailable) {
    const b = BOARDS.find((x) => x.id === unavailable);
    return { ok: false, error: `${b ? b.name : unavailable} can't be used yet.` };
  }
  if (boards.length > 2) {
    return { ok: false, error: 'Two grids is the most a game can use.' };
  }
  return { ok: true, count: boards.length };
}

// Games live in games/<slug>/:
//   game.json — name, description, boards
//   game.h    — the game (gameSetup + gameTick against firmware/kit/kit.h)
//   chat.json — the conversation that built it, with token usage
// All three are committed after every change.

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { GAMES_DIR, SLUG_RE } from './paths.mjs';
import { commitPaths } from './git.mjs';
import { validateBoards } from './hardware.mjs';

const dirOf = (slug) => {
  if (!SLUG_RE.test(String(slug))) throw new Error('Bad game name.');
  return path.join(GAMES_DIR, slug);
};
export const gamePath = (slug) => path.relative(path.resolve(GAMES_DIR, '..'), dirOf(slug));

const readJson = async (file, fallback) => {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
};
const writeJson = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);

export function slugify(name) {
  const s = String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);
  return s || `game-${Date.now().toString(36)}`;
}

// A new game is playable before the AI has written anything, so the
// kids can flash it and see the board respond straight away.
const STARTER = `// Starter game: tap a light to change its colour.
// Ask the AI to turn this into whatever you like!

static const uint8_t kRainbow[] = {kit::RED, kit::YELLOW, kit::GREEN, kit::CYAN, kit::BLUE, kit::MAGENTA};
static uint8_t s_colour[kit::kCells];

void gameSetup() {
  for (uint8_t i = 0; i < kit::kCells; i++) {
    s_colour[i] = i % 6;
    kit::set(i, kRainbow[s_colour[i]]);
  }
}

void gameTick() {
  uint8_t c = kit::firstPressed();
  if (c == kit::kNone) return;
  s_colour[c] = (s_colour[c] + 1) % 6;
  kit::set(c, kRainbow[s_colour[c]]);
}
`;

export async function listGames() {
  if (!existsSync(GAMES_DIR)) return [];
  const out = [];
  for (const e of await readdir(GAMES_DIR, { withFileTypes: true })) {
    if (!e.isDirectory() || !SLUG_RE.test(e.name)) continue;
    const g = await readJson(path.join(GAMES_DIR, e.name, 'game.json'), null);
    if (g) out.push(g);
  }
  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function getGame(slug) {
  const dir = dirOf(slug);
  const game = await readJson(path.join(dir, 'game.json'), null);
  if (!game) return null;
  return {
    game,
    code: await readFile(path.join(dir, 'game.h'), 'utf8').catch(() => ''),
    chat: await readJson(path.join(dir, 'chat.json'), []),
  };
}

export async function createGame({ name, description, boards }) {
  const check = validateBoards(boards);
  if (!check.ok) throw new Error(check.error);
  if (!String(name ?? '').trim()) throw new Error('Give the game a name.');

  let slug = slugify(name);
  if (existsSync(dirOf(slug))) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  const now = new Date().toISOString();
  const game = {
    slug,
    name: String(name).trim().slice(0, 60),
    description: String(description ?? '').trim().slice(0, 300),
    boards,
    createdAt: now,
    updatedAt: now,
  };
  const dir = dirOf(slug);
  await mkdir(dir, { recursive: true });
  await writeJson(path.join(dir, 'game.json'), game);
  await writeFile(path.join(dir, 'game.h'), STARTER);
  await writeJson(path.join(dir, 'chat.json'), []);
  await commitPaths([gamePath(slug)], `new game: ${game.name}`);
  return game;
}

export async function setBoards(slug, boards) {
  const check = validateBoards(boards);
  if (!check.ok) throw new Error(check.error);
  const file = path.join(dirOf(slug), 'game.json');
  const game = await readJson(file, null);
  if (!game) throw new Error('No such game.');
  game.boards = boards;
  game.updatedAt = new Date().toISOString();
  await writeJson(file, game);
  await commitPaths([gamePath(slug)], `${game.name}: now uses ${boards.length} board(s)`);
  return game;
}

/** Persist a chat turn (and optionally new code), then commit it all. */
export async function saveTurn(slug, { userMessage, reply, code, commitMessage }) {
  const dir = dirOf(slug);
  const game = await readJson(path.join(dir, 'game.json'), null);
  if (!game) throw new Error('No such game.');
  const chat = await readJson(path.join(dir, 'chat.json'), []);
  chat.push(userMessage, reply);
  await writeJson(path.join(dir, 'chat.json'), chat);
  if (code != null) await writeFile(path.join(dir, 'game.h'), code);
  game.updatedAt = new Date().toISOString();
  await writeJson(path.join(dir, 'game.json'), game);
  return commitPaths([gamePath(slug)], commitMessage);
}

export async function writeCode(slug, code) {
  await writeFile(path.join(dirOf(slug), 'game.h'), code);
}

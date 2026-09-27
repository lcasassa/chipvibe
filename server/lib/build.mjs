// Staging and compiling.
//
// All games share one PlatformIO env and build directory: the game is
// swapped by writing firmware/current/{game.h,game_info.h}. Files are
// only rewritten when their content changes, so the framework (and any
// unchanged game) isn't recompiled. One build at a time — they share
// .pio/build/board.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { BUILD_DIR, CURRENT_DIR, GAMES_DIR, SLUG_RE } from './paths.mjs';
import { exec, mutex } from './proc.mjs';

export const buildLock = mutex();

async function writeIfChanged(file, content) {
  const old = await readFile(file, 'utf8').catch(() => null);
  if (old !== content) await writeFile(file, content);
}

const cString = (s) => JSON.stringify(String(s)); // valid C string literal for ASCII+escapes

/** Put a game (or explicit code) where the firmware includes it from. */
export async function stage(slug, { code } = {}) {
  if (!SLUG_RE.test(slug)) throw new Error('Bad game name.');
  const dir = path.join(GAMES_DIR, slug);
  const game = JSON.parse(await readFile(path.join(dir, 'game.json'), 'utf8'));
  const body = code ?? (await readFile(path.join(dir, 'game.h'), 'utf8'));
  await mkdir(CURRENT_DIR, { recursive: true });
  await writeIfChanged(
    path.join(CURRENT_DIR, 'game_info.h'),
    `// Staged by chipvibe — do not edit.\n#pragma once\n` +
      `#define GAME_SLUG ${cString(slug)}\n` +
      `#define GAME_NAME ${cString(game.name)}\n` +
      `#define GAME_BOARDS ${Math.min(2, Math.max(1, (game.boards ?? []).length || 1))}\n`,
  );
  await writeIfChanged(path.join(CURRENT_DIR, 'game.h'), body);
  return game;
}

/** Pull the lines a model (or a person) can act on out of pio output. */
function compilerErrors(out) {
  const lines = out.split('\n');
  const keep = [];
  lines.forEach((l, i) => {
    if (/\berror\b|undefined reference/.test(l)) {
      keep.push(l.replace(/^.*firmware\/current\//, 'game.h: ').replace(/^\.\//, ''));
      if (lines[i + 1] && !/\berror\b/.test(lines[i + 1])) keep.push(lines[i + 1]);
    }
  });
  return (keep.length ? keep : lines.slice(-30)).join('\n').slice(0, 6000);
}

/**
 * Compile whatever is staged. Resolves { ok, errors, bin }. Caller must
 * hold buildLock across stage() + compile() (+ flashing).
 */
export async function compile({ onLine, signal } = {}) {
  const progress = (line) => {
    if (/^(Compiling|Linking|Building) .*(main\.cpp|firmware\.(elf|bin))/.test(line)) onLine?.(line.trim());
  };
  const r = await exec('pio', ['run', '-e', 'board'], { onLine: progress, signal, echo: false });
  if (r.code === 0) return { ok: true, errors: '', bin: path.join(BUILD_DIR, 'firmware.bin') };
  return { ok: false, errors: compilerErrors(r.out) };
}

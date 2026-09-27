// Machine-local state: settings and the token/cost log.

import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';

import { STATE_DIR } from './paths.mjs';

const SETTINGS = path.join(STATE_DIR, 'settings.json');
const USAGE = path.join(STATE_DIR, 'usage.jsonl');

// Aliases the claude CLI resolves itself (checked: haiku → claude-haiku-4-5,
// sonnet → claude-sonnet-5, opus → claude-opus-5-5 at the time of writing).
export const MODELS = [
  { id: 'sonnet', label: 'Sonnet', hint: 'good and quick — the default' },
  { id: 'opus', label: 'Opus', hint: 'smartest, slower, costs more' },
  { id: 'haiku', label: 'Haiku', hint: 'fastest and cheapest' },
];
const DEFAULTS = { model: 'sonnet' };

export async function getSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(await readFile(SETTINGS, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  if (!MODELS.some((m) => m.id === next.model)) throw new Error('Unknown model.');
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(SETTINGS, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/**
 * Record one AI call. `usage` is the claude CLI result's usage block.
 * Tokens are split the way the API bills them; `total` is all of them.
 */
export async function recordUsage({ kind, slug, model, usage, cost }) {
  const u = usage ?? {};
  const entry = {
    at: new Date().toISOString(),
    kind, // 'game' | 'repair' | 'ui'
    slug: slug ?? null,
    model: model ?? null,
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    cost: typeof cost === 'number' ? cost : 0,
  };
  entry.total = entry.input + entry.output + entry.cacheRead + entry.cacheWrite;
  await mkdir(STATE_DIR, { recursive: true });
  await appendFile(USAGE, `${JSON.stringify(entry)}\n`);
  return entry;
}

const blank = () => ({ calls: 0, total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
const add = (acc, e) => {
  acc.calls += 1;
  for (const k of ['total', 'input', 'output', 'cacheRead', 'cacheWrite', 'cost']) acc[k] += e[k] ?? 0;
  return acc;
};

export async function usageSummary() {
  let lines = [];
  try {
    lines = (await readFile(USAGE, 'utf8')).split('\n').filter(Boolean);
  } catch {
    // No calls yet.
  }
  const today = new Date().toISOString().slice(0, 10);
  const out = { all: blank(), today: blank(), byModel: {}, byGame: {}, ui: blank() };
  for (const line of lines) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    add(out.all, e);
    if (String(e.at).startsWith(today)) add(out.today, e);
    add((out.byModel[e.model ?? '?'] ??= blank()), e);
    if (e.kind === 'ui') add(out.ui, e);
    else if (e.slug) add((out.byGame[e.slug] ??= blank()), e);
  }
  return out;
}

#!/usr/bin/env node
// Stage a game for building: `node server/stage.mjs <slug>`, then
// `pio run -e board`. Used by CI; the studio calls stage() directly.
import { stage } from './lib/build.mjs';

const slug = process.argv[2];
if (!slug) {
  console.error('usage: node server/stage.mjs <game-slug>');
  process.exit(2);
}
const game = await stage(slug);
console.log(`staged ${game.name} (${slug}), ${game.boards.length} board(s)`);

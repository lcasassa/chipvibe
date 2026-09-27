import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const SERVER_DIR = path.resolve(here, '..');
export const ROOT = path.resolve(SERVER_DIR, '..');
export const GAMES_DIR = path.join(ROOT, 'games');
export const CURRENT_DIR = path.join(ROOT, 'firmware', 'current');
export const WEB_DIR = path.join(ROOT, 'web');
// Machine-local state (chosen model, token log, UI-chat history).
// Git-ignored: it's about this computer, not the games.
export const STATE_DIR = path.join(ROOT, '.chipvibe');
export const BUILD_DIR = path.join(ROOT, '.pio', 'build', 'board');

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

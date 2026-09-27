#!/usr/bin/env node
// chipvibe server. No dependencies: `node server/index.mjs` (or ./start).
//
// Binds to localhost only — it runs a compiler, the claude CLI and git.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { SERVER_DIR, WEB_DIR } from './lib/paths.mjs';
import { BOARDS } from './lib/hardware.mjs';
import * as games from './lib/games.mjs';
import * as ai from './lib/ai.mjs';
import * as build from './lib/build.mjs';
import * as boards from './lib/boards.mjs';
import * as git from './lib/git.mjs';
import * as state from './lib/state.mjs';
import * as uichat from './lib/uichat.mjs';

const PORT = Number(process.env.PORT || 4400);
const HOST = process.env.CHIPVIBE_HOST || '127.0.0.1';
const MAX_REPAIRS = 2;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 256 * 1024) throw new Error('Request too large.');
    chunks.push(c);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

/** Server-sent events over a POST response. */
function stream(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });
  const ac = new AbortController();
  req.on('close', () => ac.abort());
  const send = (type, data) => {
    if (!res.writableEnded) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const ping = setInterval(() => !res.writableEnded && res.write(': ping\n\n'), 15000);
  return {
    signal: ac.signal,
    send,
    log: (line) => send('log', { line }),
    token: (text) => send('token', { text }),
    done: (data) => {
      send('done', data);
      clearInterval(ping);
      res.end();
    },
    fail: (err) => {
      send('failed', { error: err.message ?? String(err) });
      clearInterval(ping);
      res.end();
    },
  };
}

async function requireGame(slug) {
  const g = await games.getGame(slug);
  if (!g) throw new Error('No such game.');
  return g;
}

// ── Game chat: ask → (code?) → compile → repair → commit ─────────────
async function chatTurn(slug, message, s) {
  const { game, code, chat } = await requireGame(slug);
  const { model } = await state.getSettings();
  const userMessage = { role: 'user', text: message, at: new Date().toISOString() };
  let totalTokens = 0;
  let totalCost = 0;
  const count = async (kind, r) => {
    const u = await state.recordUsage({ kind, slug, model: r.model, usage: r.usage, cost: r.cost });
    totalTokens += u.total;
    totalCost += u.cost;
  };

  const first = await ai.runClaude(ai.gamePrompt({ game, code, history: chat, message }), {
    model,
    onText: s.token,
    signal: s.signal,
  });
  await count('game', first);
  const reply = ai.parseReply(first.text);

  let newCode = reply.code;
  let built = null;
  let buildNote = '';
  if (newCode) {
    s.send('phase', { phase: 'building' });
    built = await build.buildLock(async () => {
      for (let attempt = 0; ; attempt++) {
        s.log(attempt === 0 ? '🔧 Checking the game builds…' : '🔧 Checking the fix…');
        await build.stage(slug, { code: newCode });
        const r = await build.compile({ onLine: s.log, signal: s.signal });
        if (r.ok) return true;
        s.log(`⚠️  It didn't build: ${(r.errors.split('\n').find((l) => /error/.test(l)) ?? '').slice(0, 160)}`);
        if (attempt >= MAX_REPAIRS) {
          buildNote = r.errors;
          return false;
        }
        s.log(`🩹 Asking the AI to fix it (${attempt + 1} of ${MAX_REPAIRS})…`);
        const fix = await ai.runClaude(ai.repairPrompt({ game, code: newCode, errors: r.errors }), {
          model,
          signal: s.signal,
        });
        await count('repair', fix);
        const fixed = ai.parseReply(fix.text).code;
        if (!fixed) {
          buildNote = r.errors;
          return false;
        }
        newCode = fixed;
      }
    });
  }

  const aiMessage = {
    role: 'ai',
    text:
      built === false
        ? `${reply.message}\n\n(I couldn't get that version to build, so your game is unchanged. Try asking in a different way?)`
        : reply.message,
    at: new Date().toISOString(),
    model: first.model,
    tokens: totalTokens,
    cost: totalCost,
    changedCode: built === true,
  };
  const commit = await games.saveTurn(slug, {
    userMessage,
    reply: aiMessage,
    code: built === true ? newCode : null,
    commitMessage: `${game.name}: ${message.replace(/\s+/g, ' ').slice(0, 60)}`,
  });
  aiMessage.commit = commit;
  if (built === true) s.log(`✅ Saved (commit ${commit}).`);
  return { reply: aiMessage, code: built === true ? newCode : code, buildErrors: buildNote || null };
}

// ── Routes ───────────────────────────────────────────────────────────
const routes = [
  ['GET', /^\/api\/hardware$/, async (req, res) => json(res, 200, { boards: BOARDS })],

  ['GET', /^\/api\/overview$/, async (req, res) => {
    const [list, settings, usage, gitStatus] = await Promise.all([
      games.listGames(),
      state.getSettings(),
      state.usageSummary(),
      git.status(),
    ]);
    json(res, 200, { games: list, settings, models: state.MODELS, usage, git: gitStatus });
  }],

  ['PUT', /^\/api\/settings$/, async (req, res) => json(res, 200, await state.saveSettings(await readBody(req)))],

  ['POST', /^\/api\/games$/, async (req, res) => json(res, 201, await games.createGame(await readBody(req)))],

  ['GET', /^\/api\/games\/([a-z0-9-]+)$/, async (req, res, [slug]) => json(res, 200, await requireGame(slug))],

  ['PUT', /^\/api\/games\/([a-z0-9-]+)\/boards$/, async (req, res, [slug]) => {
    const { boards: ids } = await readBody(req);
    json(res, 200, await games.setBoards(slug, ids));
  }],

  ['POST', /^\/api\/games\/([a-z0-9-]+)\/chat$/, async (req, res, [slug]) => {
    const { message } = await readBody(req);
    if (!String(message ?? '').trim()) throw new Error('Say something first.');
    await requireGame(slug);
    const s = stream(req, res);
    try {
      s.done(await chatTurn(slug, String(message).trim().slice(0, 2000), s));
    } catch (err) {
      s.fail(err);
    }
  }],

  ['GET', /^\/api\/targets$/, async (req, res) => json(res, 200, await boards.targets())],

  ['POST', /^\/api\/games\/([a-z0-9-]+)\/program$/, async (req, res, [slug]) => {
    const { targets } = await readBody(req);
    if (!Array.isArray(targets) || !targets.length) throw new Error('Pick at least one board to program.');
    await requireGame(slug);
    const s = stream(req, res);
    try {
      const results = await build.buildLock(async () => {
        const game = await build.stage(slug);
        s.log(`🔧 Building ${game.name}…`);
        const r = await build.compile({ onLine: s.log, signal: s.signal });
        if (!r.ok) throw new Error(`The game doesn't build:\n${r.errors}`);
        const out = [];
        for (const t of targets) {
          s.send('target', { id: t.id, state: 'working' });
          s.log(`📤 Programming ${t.id}…`);
          try {
            await boards.flash(t, { bin: r.bin, onLine: s.log, signal: s.signal });
            s.send('target', { id: t.id, state: 'ok' });
            s.log(`✅ ${t.id} done — it restarts into the game by itself.`);
            out.push({ id: t.id, ok: true });
          } catch (err) {
            s.send('target', { id: t.id, state: 'failed', error: err.message });
            s.log(`❌ ${t.id}: ${err.message}`);
            out.push({ id: t.id, ok: false, error: err.message });
          }
        }
        return out;
      });
      s.done({ results });
    } catch (err) {
      s.fail(err);
    }
  }],

  ['POST', /^\/api\/games\/([a-z0-9-]+)\/share$/, async (req, res, [slug]) => {
    const { game } = await requireGame(slug);
    const s = stream(req, res);
    try {
      const pr = await git.share({
        paths: [games.gamePath(slug)],
        branch: `game/${slug}`,
        title: `Game: ${game.name}`,
        body:
          `${game.description || 'A new chipvibe game.'}\n\n` +
          `Made in chipvibe for ${game.boards.length} LED button grid(s).\n\n` +
          `Once merged, CI publishes it to the \`game-${slug}\` release: a board running ` +
          `this game downloads it when the top-right button is held at power-on.`,
        onLine: s.log,
        signal: s.signal,
      });
      s.done(pr);
    } catch (err) {
      s.fail(err);
    }
  }],

  ['GET', /^\/api\/usage$/, async (req, res) => json(res, 200, await state.usageSummary())],

  ['GET', /^\/api\/ui\/history$/, async (req, res) => json(res, 200, { history: await uichat.history() })],

  ['POST', /^\/api\/ui\/chat$/, async (req, res) => {
    const { message } = await readBody(req);
    if (!String(message ?? '').trim()) throw new Error('Say what to change first.');
    const { model } = await state.getSettings();
    const s = stream(req, res);
    try {
      s.done(await uichat.improve(String(message).trim().slice(0, 2000), {
        model,
        onText: s.token,
        onLine: s.log,
        signal: s.signal,
      }));
    } catch (err) {
      s.fail(err);
    }
  }],

  ['POST', /^\/api\/ui\/undo$/, async (req, res) => json(res, 200, await uichat.undo())],

  ['POST', /^\/api\/ui\/share$/, async (req, res) => {
    const s = stream(req, res);
    try {
      s.done(await git.share({
        paths: ['web'],
        branch: 'app/ui-improvements',
        title: 'App: UI improvements from the Improve-the-app chat',
        body: 'Changes to the chipvibe web UI, made through its built-in "Improve the app" chat.',
        onLine: s.log,
        signal: s.signal,
      }));
    } catch (err) {
      s.fail(err);
    }
  }],
];

async function serveFile(res, file) {
  if (!existsSync(file)) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(await readFile(file));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    for (const [method, re, handler] of routes) {
      if (req.method !== method) continue;
      const m = re.exec(url.pathname);
      if (m) {
        await handler(req, res, m.slice(1));
        return;
      }
    }
    if (req.method !== 'GET') {
      json(res, 404, { error: 'Not found' });
      return;
    }
    // The undo page lives in server/, out of reach of the UI chat.
    if (url.pathname === '/safe') return serveFile(res, path.join(SERVER_DIR, 'safe.html'));
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.resolve(WEB_DIR, rel);
    if (!file.startsWith(WEB_DIR + path.sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    await serveFile(res, file);
  } catch (err) {
    if (res.headersSent) {
      if (!res.writableEnded) res.end();
      return;
    }
    json(res, 400, { error: err.message ?? String(err) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  🎮 chipvibe → http://${HOST}:${PORT}\n     undo page → http://${HOST}:${PORT}/safe\n`);
});

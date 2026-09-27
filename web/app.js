// chipvibe front end — plain JS, no framework, no build step.
//
// Screens: home (pick/create a game) and game (chat + program + share).
// Plus two dialogs (new game / hardware, token usage) and the
// "Improve the app" drawer. The server API used here:
//   GET  /api/overview            games, settings, models, usage, git
//   GET  /api/hardware            board catalogue
//   PUT  /api/settings            { model }
//   POST /api/games               { name, description, boards }
//   GET  /api/games/:slug         { game, code, chat }
//   PUT  /api/games/:slug/boards  { boards }
//   POST /api/games/:slug/chat    SSE: token, log, phase, done, failed
//   GET  /api/targets             { usb: [...], wifi: [...] }
//   POST /api/games/:slug/program SSE: log, target, done, failed
//   POST /api/games/:slug/share   SSE: log, done { url }, failed
//   GET  /api/usage
//   GET  /api/ui/history · POST /api/ui/chat (SSE) · POST /api/ui/undo · POST /api/ui/share (SSE)

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const state = {
  games: [],
  boards: [],
  models: [],
  settings: {},
  current: null, // { game, code, chat }
  targets: [],
  selectedTargets: new Set(),
  busy: false,
};

// ── Helpers ────────────────────────────────────────────────────────────

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

let toastTimer;
function toast(message, kind = 'info') {
  const t = $('#toast');
  t.textContent = message;
  t.className = `toast ${kind}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 5000);
}

/** POST and consume server-sent events. Resolves with `done` data. */
async function streamPost(path, body, handlers = {}) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let outcome = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const type = /^event: (.+)$/m.exec(frame)?.[1];
      const data = /^data: (.+)$/m.exec(frame)?.[1];
      if (!type || !data) continue;
      const payload = JSON.parse(data);
      if (type === 'done') outcome = { done: payload };
      else if (type === 'failed') outcome = { failed: payload };
      else handlers[type]?.(payload);
    }
  }
  if (outcome?.failed) throw new Error(outcome.failed.error);
  if (!outcome?.done) throw new Error('The connection dropped before it finished.');
  return outcome.done;
}

function logTo(pre, line) {
  pre.hidden = false;
  pre.textContent += `${line}\n`;
  pre.scrollTop = pre.scrollHeight;
}

const fmtTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`);
const fmtCost = (c) => `$${(c ?? 0).toFixed(c >= 1 ? 2 : 3)}`;

// ── Overview: games list, model picker, usage ──────────────────────────

async function refreshOverview() {
  const o = await api('/api/overview');
  state.games = o.games;
  state.models = o.models;
  state.settings = o.settings;
  renderSwitcher();
  renderModel();
  renderUsageChip(o.usage);
  if (!state.current) renderHome();
}

function renderSwitcher() {
  const sel = $('#game-switcher');
  sel.replaceChildren(new Option('🏠 All games', ''));
  for (const g of state.games) sel.append(new Option(`${g.boards.length > 1 ? '🎮🎮' : '🎮'} ${g.name}`, g.slug));
  sel.value = state.current?.game.slug ?? '';
}

function renderModel() {
  const sel = $('#model');
  sel.replaceChildren(...state.models.map((m) => new Option(`${m.label} — ${m.hint}`, m.id)));
  sel.value = state.settings.model;
}

function renderUsageChip(usage) {
  state.usage = usage;
  $('#usage-chip').textContent = `🪙 ${fmtTokens(usage.today.total)} today · ${fmtCost(usage.today.cost)}`;
}

function renderUsageDialog() {
  const u = state.usage;
  const body = $('#usage-body');
  body.replaceChildren();
  const table = (title, rows) => {
    body.append(el('h4', null, title));
    const t = el('table', 'usage');
    t.append(Object.assign(el('tr'), { innerHTML: '<th></th><th>calls</th><th>tokens</th><th>cost</th>' }));
    for (const [label, v] of rows) {
      const tr = el('tr');
      tr.append(el('td', null, label), el('td', null, v.calls), el('td', null, fmtTokens(v.total)), el('td', null, fmtCost(v.cost)));
      t.append(tr);
    }
    body.append(t);
  };
  table('Totals', [['Today', u.today], ['All time', u.all], ['Improve-the-app', u.ui]]);
  table('By model', Object.entries(u.byModel));
  const names = Object.fromEntries(state.games.map((g) => [g.slug, g.name]));
  table('By game', Object.entries(u.byGame).map(([slug, v]) => [names[slug] ?? slug, v]));
  body.append(el('p', 'muted small', 'Costs are what the claude CLI reports. On a subscription plan you may not be billed per token.'));
}

// ── Home ───────────────────────────────────────────────────────────────

function renderHome() {
  $('#home').hidden = false;
  $('#game').hidden = true;
  const grid = $('#game-grid');
  grid.replaceChildren();

  const add = el('button', 'game-card new');
  add.append(el('span', 'big-emoji', '＋'), el('b', null, 'New game'));
  add.onclick = () => openGameDialog();
  grid.append(add);

  for (const g of state.games) {
    const card = el('button', 'game-card');
    card.append(
      el('span', 'big-emoji', g.boards.length > 1 ? '🎮🎮' : '🎮'),
      el('b', null, g.name),
      el('span', 'muted small', g.description || ''),
    );
    card.onclick = () => openGame(g.slug);
    grid.append(card);
  }
}

// ── A game ─────────────────────────────────────────────────────────────

async function openGame(slug) {
  if (!slug) {
    state.current = null;
    localStorage.removeItem('chipvibe:game');
    renderSwitcher();
    renderHome();
    return;
  }
  state.current = await api(`/api/games/${slug}`);
  localStorage.setItem('chipvibe:game', slug);
  $('#home').hidden = true;
  $('#game').hidden = false;
  renderSwitcher();
  renderGameHead();
  renderThread();
  $('#code').textContent = state.current.code;
  $('#share-log').hidden = true;
  $('#program-log').hidden = true;
  $('#message').focus();
  scanTargets();
}

function renderGameHead() {
  const { game } = state.current;
  $('#game-name').textContent = game.name;
  $('#game-desc').textContent = game.description || '';
  const chips = $('#btn-hardware');
  chips.replaceChildren();
  const counts = {};
  for (const id of game.boards) counts[id] = (counts[id] ?? 0) + 1;
  for (const [id, n] of Object.entries(counts)) {
    const b = state.boards.find((x) => x.id === id);
    chips.append(el('span', 'chip', `${b?.emoji ?? ''} ${n > 1 ? `${n}× ` : ''}${b?.name ?? id}`));
  }
  chips.append(el('span', 'muted small', ' ✏️'));
}

function messageBubble(m) {
  const wrap = el('div', `msg ${m.role}`);
  wrap.append(el('div', 'bubble', m.text));
  if (m.role === 'ai') {
    const meta = [];
    if (m.changedCode) meta.push('🔧 game updated');
    if (m.model) meta.push(m.model.replace(/^claude-/, ''));
    if (m.tokens) meta.push(`${fmtTokens(m.tokens)} tokens`);
    if (m.cost) meta.push(fmtCost(m.cost));
    if (m.commit) meta.push(`saved ${m.commit}`);
    if (meta.length) wrap.append(el('div', 'meta', meta.join(' · ')));
  }
  return wrap;
}

function renderThread() {
  const thread = $('#thread');
  thread.replaceChildren();
  const { chat, game } = state.current;
  if (!chat.length) {
    const hello = el('div', 'msg ai');
    hello.append(
      el(
        'div',
        'bubble',
        `Hi! I'm ready to build “${game.name}” with you. Right now it's a starter game — tap a light to change its colour. Tell me what you want it to be!`,
      ),
    );
    thread.append(hello);
  }
  for (const m of chat) thread.append(messageBubble(m));
  thread.scrollTop = thread.scrollHeight;
}

// While streaming, hide code as it's written: kids see the words.
function visibleText(raw) {
  const i = raw.indexOf('```');
  if (i === -1) return raw;
  return `${raw.slice(0, i).trim()}\n\n✍️ writing the game…`;
}

async function sendMessage(ev) {
  ev.preventDefault();
  if (state.busy) return;
  const input = $('#message');
  const text = input.value.trim();
  if (!text) return;
  state.busy = true;
  input.value = '';
  $('#btn-send').disabled = true;

  const thread = $('#thread');
  thread.append(messageBubble({ role: 'user', text }));
  const pending = el('div', 'msg ai pending');
  const bubble = el('div', 'bubble', '🤔 thinking…');
  const log = el('div', 'meta');
  pending.append(bubble, log);
  thread.append(pending);
  thread.scrollTop = thread.scrollHeight;

  let raw = '';
  try {
    const result = await streamPost(`/api/games/${state.current.game.slug}/chat`, { message: text }, {
      token: ({ text: t }) => {
        raw += t;
        bubble.textContent = visibleText(raw);
        thread.scrollTop = thread.scrollHeight;
      },
      log: ({ line }) => {
        if (!/^(Compiling|Linking|Building)/.test(line)) log.textContent = line;
      },
    });
    state.current.chat.push({ role: 'user', text }, result.reply);
    state.current.code = result.code;
    $('#code').textContent = result.code;
    renderThread();
    if (result.reply.changedCode) toast('Game updated! Press Program to try it.', 'ok');
    refreshOverview();
  } catch (err) {
    bubble.textContent = `❌ ${err.message}`;
    pending.classList.remove('pending');
  } finally {
    state.busy = false;
    $('#btn-send').disabled = false;
    input.focus();
  }
}

// ── Hardware (new game + change hardware) ──────────────────────────────

let dialogMode = 'new';
let draftBoards = [];

function renderHardwarePicker() {
  const grid = $('#hw-grid');
  grid.replaceChildren();
  for (const b of state.boards) {
    const n = draftBoards.filter((x) => x === b.id).length;
    const card = el('div', `hw-card${b.available ? '' : ' disabled'}${n ? ' selected' : ''}`);
    card.append(el('span', 'big-emoji', b.emoji), el('b', null, b.name), el('span', 'muted small', b.blurb));
    if (!b.available) {
      card.append(el('span', 'badge', b.reason || 'Not yet'));
    } else {
      const step = el('div', 'stepper');
      const minus = el('button', 'ghost small', '−');
      const count = el('span', 'count', String(n));
      const plus = el('button', 'ghost small', '＋');
      minus.type = plus.type = 'button';
      minus.disabled = n === 0;
      plus.disabled = n >= (b.max ?? 1);
      minus.onclick = () => {
        const i = draftBoards.lastIndexOf(b.id);
        if (i !== -1) draftBoards.splice(i, 1);
        renderHardwarePicker();
      };
      plus.onclick = () => {
        draftBoards.push(b.id);
        renderHardwarePicker();
      };
      step.append(minus, count, plus);
      card.append(step);
      if (n === 2) card.append(el('span', 'muted small', 'Two grids talk to each other over the radio.'));
    }
    grid.append(card);
  }
}

function openGameDialog(mode = 'new') {
  dialogMode = mode;
  $('#dlg-error').textContent = '';
  if (mode === 'new') {
    $('#dlg-title').textContent = 'New game';
    $('#dlg-ok').textContent = 'Create';
    $('#dlg-name-fields').hidden = false;
    $('#new-name').value = '';
    $('#new-desc').value = '';
    draftBoards = ['grid'];
  } else {
    $('#dlg-title').textContent = 'Change hardware';
    $('#dlg-ok').textContent = 'Save';
    $('#dlg-name-fields').hidden = true;
    draftBoards = [...state.current.game.boards];
  }
  renderHardwarePicker();
  $('#dlg-game').showModal();
  if (mode === 'new') $('#new-name').focus();
}

async function submitGameDialog(ev) {
  // Enter in a text field submits with no submitter — treat as OK.
  if (ev.submitter && ev.submitter.value !== 'ok') return;
  ev.preventDefault();
  try {
    if (dialogMode === 'new') {
      const game = await api('/api/games', {
        method: 'POST',
        body: JSON.stringify({ name: $('#new-name').value, description: $('#new-desc').value, boards: draftBoards }),
      });
      $('#dlg-game').close();
      await refreshOverview();
      await openGame(game.slug);
    } else {
      const game = await api(`/api/games/${state.current.game.slug}/boards`, {
        method: 'PUT',
        body: JSON.stringify({ boards: draftBoards }),
      });
      $('#dlg-game').close();
      state.current.game = game;
      renderGameHead();
      toast('Hardware saved. Ask the AI to update the game for it.', 'ok');
      refreshOverview();
    }
  } catch (err) {
    $('#dlg-error').textContent = err.message;
  }
}

// ── Programming ────────────────────────────────────────────────────────

async function scanTargets() {
  $('#targets-hint').textContent = 'Looking for boards…';
  $('#btn-rescan').disabled = true;
  try {
    const t = await api('/api/targets');
    state.targets = [...t.usb, ...t.wifi];
    // Keep previous choices; tick everything new by default.
    const known = new Set(state.targets.map((x) => x.id));
    for (const id of [...state.selectedTargets]) if (!known.has(id)) state.selectedTargets.delete(id);
    if (!state.selectedTargets.size) state.targets.forEach((x) => state.selectedTargets.add(x.id));
    renderTargets();
  } catch (err) {
    $('#targets-hint').textContent = err.message;
  } finally {
    $('#btn-rescan').disabled = false;
  }
}

function renderTargets() {
  const box = $('#targets');
  box.replaceChildren();
  const need = state.current?.game.boards.length ?? 1;
  $('#targets-hint').textContent = state.targets.length
    ? `Tick the board${need > 1 ? 's' : ''} to program.${need > 1 ? ' This game needs 2 — program both.' : ''}`
    : 'No boards found. Plug one in with a USB cable, then press “Look again”.';
  for (const t of state.targets) {
    const row = el('label', 'target');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = state.selectedTargets.has(t.id);
    cb.onchange = () => {
      if (cb.checked) state.selectedTargets.add(t.id);
      else state.selectedTargets.delete(t.id);
      $('#btn-program').disabled = !state.selectedTargets.size;
    };
    row.append(cb, el('span', null, t.label), el('span', 'status', ''));
    row.dataset.id = t.id;
    box.append(row);
  }
  $('#btn-program').disabled = !state.selectedTargets.size;
  $('#btn-program').textContent = state.selectedTargets.size > 1 ? `Program ${state.selectedTargets.size} boards` : 'Program';
}

async function program() {
  const chosen = state.targets.filter((t) => state.selectedTargets.has(t.id)).map(({ kind, id }) => ({ kind, id }));
  if (!chosen.length) return;
  const btn = $('#btn-program');
  const log = $('#program-log');
  btn.disabled = true;
  btn.textContent = '⏳ Working…';
  log.textContent = '';
  try {
    const { results } = await streamPost(`/api/games/${state.current.game.slug}/program`, { targets: chosen }, {
      log: ({ line }) => {
        if (!/^(Writing at|Compiling|Linking)/.test(line)) logTo(log, line);
      },
      target: ({ id, state: s }) => {
        const status = document.querySelector(`.target[data-id="${CSS.escape(id)}"] .status`);
        if (status) status.textContent = { working: '⏳', ok: '✅', failed: '❌' }[s] ?? '';
      },
    });
    const bad = results.filter((r) => !r.ok);
    toast(bad.length ? `${bad.length} board(s) failed — see the log.` : 'Programmed! 🎉', bad.length ? 'error' : 'ok');
  } catch (err) {
    logTo(log, `❌ ${err.message}`);
    toast(err.message.split('\n')[0], 'error');
  } finally {
    renderTargets();
  }
}

// ── Sharing ────────────────────────────────────────────────────────────

async function share(path, logEl, button) {
  button.disabled = true;
  logEl.textContent = '';
  try {
    const { url } = await streamPost(path, {}, { log: ({ line }) => logTo(logEl, line) });
    logEl.textContent += '\n';
    const a = el('a', null, `🔗 ${url}`);
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    logEl.append(a);
    toast('Shared on GitHub!', 'ok');
  } catch (err) {
    logTo(logEl, `❌ ${err.message}`);
    toast(err.message, 'error');
  } finally {
    button.disabled = false;
  }
}

// ── Improve the app ────────────────────────────────────────────────────

async function openDrawer() {
  $('#drawer').hidden = false;
  const { history } = await api('/api/ui/history');
  const thread = $('#ui-thread');
  thread.replaceChildren();
  if (!history.length) {
    thread.append(messageBubble({ role: 'ai', text: 'What would you like to change about this app?' }));
  }
  for (const m of history) thread.append(messageBubble({ ...m, commit: m.sha }));
  thread.scrollTop = thread.scrollHeight;
  $('#ui-message').focus();
}

async function sendUiMessage(ev) {
  ev.preventDefault();
  const input = $('#ui-message');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  $('#btn-ui-send').disabled = true;
  const thread = $('#ui-thread');
  thread.append(messageBubble({ role: 'user', text }));
  const pending = el('div', 'msg ai pending');
  const bubble = el('div', 'bubble', '🛠 working on it…');
  pending.append(bubble);
  thread.append(pending);
  const log = $('#ui-log');
  log.textContent = '';
  let raw = '';
  try {
    const r = await streamPost('/api/ui/chat', { message: text }, {
      token: ({ text: t }) => {
        raw += t;
        bubble.textContent = raw;
      },
      log: ({ line }) => logTo(log, line),
    });
    bubble.textContent = r.summary;
    pending.classList.remove('pending');
    if (r.changed) {
      toast('App updated — reloading…', 'ok');
      setTimeout(() => location.reload(), 1500);
    } else {
      toast('Nothing in the app changed.', 'info');
    }
    refreshOverview();
  } catch (err) {
    bubble.textContent = `❌ ${err.message}`;
    pending.classList.remove('pending');
  } finally {
    $('#btn-ui-send').disabled = false;
  }
}

async function undoUi() {
  try {
    const r = await api('/api/ui/undo', { method: 'POST' });
    toast(`Undone: ${r.subject.replace(/^ui: /, '')} — reloading…`, 'ok');
    setTimeout(() => location.reload(), 1200);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Boot ───────────────────────────────────────────────────────────────

async function init() {
  state.boards = (await api('/api/hardware')).boards;
  await refreshOverview();

  $('#go-home').onclick = () => openGame('');
  $('#game-switcher').onchange = (e) => openGame(e.target.value);
  $('#btn-new').onclick = () => openGameDialog('new');
  $('#btn-hardware').onclick = () => openGameDialog('hardware');
  $('#form-game').addEventListener('submit', submitGameDialog);
  $('#dlg-cancel').onclick = () => $('#dlg-game').close();
  $('#composer').addEventListener('submit', sendMessage);
  $('#message').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('#composer').requestSubmit();
    }
  });
  $('#model').onchange = async (e) => {
    state.settings = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ model: e.target.value }) });
    toast(`AI model: ${e.target.selectedOptions[0].text.split(' — ')[0]}`, 'ok');
  };
  $('#usage-chip').onclick = async () => {
    renderUsageChip(await api('/api/usage'));
    renderUsageDialog();
    $('#dlg-usage').showModal();
  };
  $('#btn-rescan').onclick = scanTargets;
  $('#btn-program').onclick = program;
  $('#btn-share').onclick = () => share(`/api/games/${state.current.game.slug}/share`, $('#share-log'), $('#btn-share'));
  $('#btn-improve').onclick = openDrawer;
  $('#btn-close-drawer').onclick = () => ($('#drawer').hidden = true);
  $('#ui-composer').addEventListener('submit', sendUiMessage);
  $('#btn-ui-undo').onclick = undoUi;
  $('#btn-ui-share').onclick = () => share('/api/ui/share', $('#ui-log'), $('#btn-ui-share'));

  const last = localStorage.getItem('chipvibe:game');
  if (last && state.games.some((g) => g.slug === last)) await openGame(last);
}

init().catch((err) => toast(err.message, 'error'));

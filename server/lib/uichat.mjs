// "Improve the app" chat: lets the kids change chipvibe's own web UI by
// asking for it.
//
// This is the one place the AI can edit files, so it's fenced in:
//   * It runs with its working directory set to web/ and only the
//     Read/Edit/Write/Glob/Grep tools; shell and web access are denied.
//   * Afterwards, any file outside web/ that it changed is put back.
//   * Every change is committed on its own ("ui: …"), so it can always
//     be undone — including from /safe, a page served from server/ that
//     the AI can't touch, in case a change breaks the main UI.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ROOT, STATE_DIR, WEB_DIR } from './paths.mjs';
import { runClaude } from './ai.mjs';
import { commitPaths, revertLatest } from './git.mjs';
import { exec } from './proc.mjs';
import { recordUsage } from './state.mjs';

const HISTORY = path.join(STATE_DIR, 'ui-chat.json');

export async function history() {
  try {
    return JSON.parse(await readFile(HISTORY, 'utf8'));
  } catch {
    return [];
  }
}

async function saveHistory(items) {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(HISTORY, `${JSON.stringify(items.slice(-100), null, 2)}\n`);
}

async function dirtyFiles() {
  const r = await exec('git', ['status', '--porcelain', '--untracked-files=all'], { echo: false });
  return new Set(
    r.out
      .split('\n')
      .filter(Boolean)
      .map((l) => l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop()),
  );
}

const PROMPT = (message, recent) => `You are improving "chipvibe", a web app kids use to make games for a
3×3 LED button grid. The kid using it just asked for a change to the app itself.

Your working directory is the app's web front end:
  index.html — the page
  app.js     — all behaviour (plain JavaScript modules, no framework, no build step)
  styles.css — all styling

You may ONLY edit files in this directory. The server (../server) is off limits,
and its API must keep working exactly as the current app.js uses it — read
app.js to see the endpoints before changing anything that calls them.

Rules:
- Keep every existing feature working: choosing/creating games, picking
  hardware, the game chat, programming boards, sharing to GitHub, the model
  picker, the token counter, and this "Improve the app" chat.
- Always keep a visible link to /safe (the undo page) somewhere in the app.
- No external scripts, fonts or network requests; no build tools.
- Make the smallest change that does what they asked. Kid-friendly, readable.
- When you're done, reply with 1–3 short, simple sentences saying what you
  changed. No code in the reply.
${recent ? `\nEarlier requests in this chat:\n${recent}\n` : ''}
The kid asked:
"""
${message}
"""`;

export async function improve(message, { model, onText, onLine, signal }) {
  const before = await dirtyFiles();
  const past = await history();
  const recent = past
    .filter((m) => m.role === 'user')
    .slice(-5)
    .map((m) => `- ${m.text}`)
    .join('\n');

  const result = await runClaude(PROMPT(message, recent), {
    model,
    cwd: WEB_DIR,
    extraArgs: [
      '--permission-mode',
      'acceptEdits',
      '--allowedTools',
      'Read,Edit,Write,Glob,Grep',
      '--disallowedTools',
      'Bash,WebFetch,WebSearch,Task,NotebookEdit',
    ],
    onText,
    onTool: (t) => {
      const file = t.input?.file_path ? path.relative(WEB_DIR, t.input.file_path) : '';
      if (['Edit', 'Write'].includes(t.name)) onLine?.(`✏️  ${t.name} ${file}`);
    },
    signal,
  });
  const usage = await recordUsage({ kind: 'ui', model: result.model, usage: result.usage, cost: result.cost });

  // Put back anything outside web/ that was clean before and isn't now.
  const after = await dirtyFiles();
  const webRel = path.relative(ROOT, WEB_DIR) + '/';
  const strays = [...after].filter((f) => !f.startsWith(webRel) && !before.has(f));
  for (const f of strays) {
    const tracked = (await exec('git', ['ls-files', '--error-unmatch', f], { echo: false })).code === 0;
    if (tracked) await exec('git', ['checkout', '--', f], { echo: false });
    else await rm(path.join(ROOT, f), { force: true, recursive: true });
    onLine?.(`↩️  Put back ${f} (outside the app's web folder).`);
  }

  const summary = result.text.replace(/```[\s\S]*?```/g, '').trim() || 'Done.';
  const sha = await commitPaths([webRel], `ui: ${message.replace(/\s+/g, ' ').slice(0, 60)}`);
  const turn = [
    { role: 'user', text: message, at: new Date().toISOString() },
    { role: 'ai', text: summary, at: new Date().toISOString(), sha, usage, model: result.model },
  ];
  await saveHistory([...past, ...turn]);
  return { summary, sha, usage, changed: Boolean(sha) };
}

export async function undo() {
  const webRel = path.relative(ROOT, WEB_DIR) + '/';
  const r = await revertLatest('ui: ', { onlyPaths: [webRel] });
  const past = await history();
  past.push({ role: 'ai', text: `Undid: ${r.subject.replace(/^ui: /, '')}`, at: new Date().toISOString() });
  await saveHistory(past);
  return r;
}

import { spawn } from 'node:child_process';

import { ROOT } from './paths.mjs';

/**
 * Run a command. Streams lines to `onLine` (if given) and resolves with
 * { code, out }. Never rejects for a non-zero exit — callers decide —
 * only when the command can't start at all.
 */
export function exec(cmd, args, { cwd = ROOT, onLine, signal, env, echo = true } = {}) {
  return new Promise((resolve, reject) => {
    if (echo) onLine?.(`$ ${cmd} ${args.join(' ')}`);
    let child;
    try {
      child = spawn(cmd, args, {
        cwd,
        signal,
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      reject(new Error(`${cmd}: ${err.message}`));
      return;
    }
    let out = '';
    let buf = '';
    const pump = (chunk) => {
      const s = chunk.toString();
      out += s;
      if (!onLine) return;
      buf += s;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        onLine(buf.slice(0, nl).replace(/\r$/, ''));
        buf = buf.slice(nl + 1);
      }
    };
    child.stdout.on('data', pump);
    child.stderr.on('data', pump);
    child.on('error', (err) => reject(new Error(`${cmd}: ${err.message}`)));
    child.on('close', (code) => {
      if (onLine && buf.trim()) onLine(buf.trim());
      resolve({ code, out });
    });
  });
}

/** Like exec, but rejects on a non-zero exit. */
export async function run(cmd, args, opts = {}) {
  const r = await exec(cmd, args, opts);
  if (r.code !== 0) {
    const tail = r.out.trim().split('\n').slice(-3).join(' | ');
    throw new Error(`${cmd} ${args[0] ?? ''} failed (${r.code})${tail ? `: ${tail}` : ''}`);
  }
  return r.out;
}

/** A one-at-a-time lock: builds share one PlatformIO build directory. */
export function mutex() {
  let tail = Promise.resolve();
  return (fn) => {
    const next = tail.then(fn, fn);
    tail = next.catch(() => {});
    return next;
  };
}

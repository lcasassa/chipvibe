// Local commits and GitHub pull requests.
//
// Everything the kids do is committed to the local repo straight away,
// so nothing is ever lost and every change can be undone. Sharing opens
// (or updates) a PR that contains ONLY the files being shared, built on
// top of origin/main in a temporary worktree — so one game's PR never
// drags in other games or half-finished work.

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { exec, run } from './proc.mjs';

const git = (args, opts = {}) => run('git', args, { echo: false, ...opts });
const gitOk = async (args, opts = {}) => (await exec('git', args, { echo: false, ...opts })).code === 0;

/**
 * Commit exactly `paths` (added/changed/deleted). `--only` means anything
 * else that happens to be staged is left alone. Returns the new commit
 * sha, or null if those paths had no changes.
 */
export async function commitPaths(paths, message) {
  await git(['add', '-A', '--', ...paths]);
  const staged = await exec('git', ['diff', '--cached', '--quiet', '--', ...paths], { echo: false });
  if (staged.code === 0) return null; // nothing changed
  await git(['commit', '--only', '-q', '-m', message, '--', ...paths]);
  return (await git(['rev-parse', '--short', 'HEAD'])).trim();
}

export async function status() {
  const [branch, remote, last] = await Promise.all([
    git(['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => null),
    git(['remote', 'get-url', 'origin']).catch(() => null),
    git(['log', '-8', '--format=%h%x09%ar%x09%s']).catch(() => ''),
  ]);
  return {
    branch: branch?.trim() ?? null,
    remote: remote?.trim() ?? null,
    web: remote ? webUrl(remote.trim()) : null,
    commits: last
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [sha, when, subject] = l.split('\t');
        return { sha, when, subject };
      }),
  };
}

export function webUrl(remote) {
  return String(remote)
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/\.git$/, '');
}

/**
 * Open or update a PR containing `paths` exactly as they are in the
 * local HEAD.
 *
 * If GitHub's `main` doesn't exist yet (brand-new repo), the repo's
 * first commit — the chipvibe app itself — is pushed as `main` first so
 * there is something to open a PR against.
 */
export async function share({ paths, branch, title, body, onLine, signal }) {
  const say = (s) => onLine?.(s);
  const remote = (await git(['remote', 'get-url', 'origin']).catch(() => '')).trim();
  if (!remote) throw new Error('This repo has no GitHub remote called "origin".');

  say('Talking to GitHub…');
  await run('git', ['fetch', 'origin', '--prune'], { onLine, signal });

  if (!(await gitOk(['rev-parse', '--verify', '-q', 'origin/main']))) {
    const root = (await git(['rev-list', '--max-parents=0', 'HEAD'])).trim().split('\n')[0];
    say(`GitHub has no main branch yet — publishing the app itself (${root.slice(0, 7)}) as main.`);
    await run('git', ['push', 'origin', `${root}:refs/heads/main`], { onLine, signal });
    await run('git', ['fetch', 'origin'], { onLine, signal });
  }

  const remoteBranch = `origin/${branch}`;
  const exists = await gitOk(['rev-parse', '--verify', '-q', remoteBranch]);
  const base = exists ? remoteBranch : 'origin/main';

  // The commit whose files we're sharing. The worktree shares this
  // repo's object store, so it can check paths out of it by sha without
  // ever touching the main working copy or its index.
  const localHead = (await git(['rev-parse', 'HEAD'])).trim();

  const dir = await mkdtemp(path.join(os.tmpdir(), 'chipvibe-share-'));
  try {
    await git(['worktree', 'add', '-q', '--detach', dir, base]);
    const wt = { cwd: dir };
    await git(['checkout', '-q', '-B', branch], wt);

    // Mirror each path from local HEAD, including deletions.
    for (const p of paths) {
      await exec('git', ['rm', '-r', '-q', '--ignore-unmatch', '--', p], { cwd: dir, echo: false });
      if (await gitOk(['cat-file', '-e', `${localHead}:${p}`])) {
        await git(['checkout', localHead, '--', p], wt);
      }
    }
    await git(['add', '-A', '--', ...paths], wt);
    const changed = !(await gitOk(['diff', '--cached', '--quiet'], wt));
    if (changed) {
      await git(['commit', '-q', '-m', title], wt);
      say('Committed on the share branch.');
    } else {
      say('GitHub already has this exact version.');
    }
    await run('git', ['push', '-u', 'origin', `${branch}:${branch}`], { onLine, signal, cwd: dir });
  } finally {
    await exec('git', ['worktree', 'remove', '--force', dir], { echo: false });
    await rm(dir, { recursive: true, force: true });
  }

  // Reuse the open PR for this branch if there is one.
  const view = await exec('gh', ['pr', 'view', branch, '--json', 'url,state', '-q', '.url + " " + .state'], {
    echo: false,
  });
  const [existingUrl, state] = view.out.trim().split(' ');
  if (view.code === 0 && existingUrl && state === 'OPEN') {
    say(`Updated the pull request: ${existingUrl}`);
    return { url: existingUrl, created: false };
  }
  const out = await run(
    'gh',
    ['pr', 'create', '--base', 'main', '--head', branch, '--title', title, '--body', body],
    { onLine, signal },
  );
  const url = out.trim().split('\n').pop();
  say(`Opened a pull request: ${url}`);
  return { url, created: true };
}

/** Revert the most recent commit whose subject starts with `prefix`. */
export async function revertLatest(prefix, { onlyPaths } = {}) {
  // Commits already undone, so repeated "undo" walks further back
  // instead of re-reverting the same change.
  const revertBodies = await git(['log', '-200', '--grep=This reverts commit', '--format=%b']);
  const reverted = new Set([...revertBodies.matchAll(/This reverts commit ([0-9a-f]{40})/g)].map((m) => m[1]));

  const log = await git(['log', '-200', '--format=%H%x09%s']);
  const hit = log
    .trim()
    .split('\n')
    .map((l) => l.split('\t'))
    .find(([sha, subject]) => subject?.startsWith(prefix) && !reverted.has(sha));
  if (!hit) throw new Error('Nothing to undo.');
  const [sha, subject] = hit;
  if (onlyPaths) {
    const files = (await git(['show', '--name-only', '--format=', sha])).trim().split('\n');
    const stray = files.filter((f) => f && !onlyPaths.some((p) => f.startsWith(p)));
    if (stray.length) throw new Error(`That change touched other files (${stray[0]}); undo it by hand.`);
  }
  await git(['revert', '--no-edit', sha]);
  return { reverted: sha.slice(0, 7), subject };
}

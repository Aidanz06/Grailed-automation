/*
 * In-app one-click updater (friend-beta QoL). Testers run the app from a git
 * clone (`npm run ui:build && npm run ui`); updating used to mean git + npm in
 * Terminal — this module does the same four steps from an in-app button:
 *
 *   git fetch → (git stash if dirty) → git pull --ff-only → npm install →
 *   npm run ui:build → app.relaunch()
 *
 * Main-process only (child_process.spawn, cwd = repo root). Strictly repo
 * plumbing: never touches .env.local, data/, or .chrome-profile/ (git pull
 * can't — they're gitignored — and `git stash` only stashes tracked files).
 * Diverged clones are REPORTED, never force-resolved (--ff-only). If the app
 * isn't running from a git clone (no .git — e.g. a future packaged build),
 * every entry point reports { supported: false } and the UI hides the feature.
 *
 * CLI test mode (no Electron needed):
 *   node ui/updater.js check [--root <path>]
 *   node ui/updater.js apply [--root <path>]
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.join(__dirname, '..');

// Cancel/abort bookkeeping: one update at a time (main.js also gates this).
// Cancelling kills the CURRENT child — allowed only before the build starts
// (git pull and npm install are safe to re-run; killing a half-written build
// would leave dist/ broken with no obvious fix for a tester).
let currentChild = null;
let cancelRequested = false;
let cancelable = true;

function isGitClone(root) {
  return fs.existsSync(path.join(root, '.git'));
}

/*
 * Run one command, streaming trimmed output lines to onLine (throttling is the
 * caller's concern). Resolves { code, out, error? } — NEVER rejects, so the
 * IPC layer can always hand the renderer a structured result. ENOENT (git/npm
 * not on PATH — app launched outside Terminal) gets a friendly message.
 */
function run(cmd, args, root, onLine) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd: root, env: process.env });
    } catch (err) {
      resolve({ code: -1, out: [], error: err.message });
      return;
    }
    currentChild = child;
    const out = [];
    const push = (chunk) => {
      for (const raw of String(chunk).split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        out.push(line);
        if (out.length > 40) out.shift(); // keep the tail — enough for an error report
        if (onLine) onLine(line);
      }
    };
    if (child.stdout) child.stdout.on('data', push);
    if (child.stderr) child.stderr.on('data', push);
    child.on('error', (err) => {
      currentChild = null;
      resolve({
        code: -1,
        out,
        error:
          err.code === 'ENOENT'
            ? `\`${cmd}\` isn’t available to the app — start Tailor from Terminal (like the setup guide shows) so git and npm are on its PATH, then try again.`
            : err.message,
      });
    });
    child.on('close', (code) => {
      currentChild = null;
      resolve({ code: code == null ? -1 : code, out });
    });
  });
}

/*
 * Is an update available? Never throws — errors come back as a string so the
 * renderer always gets a plain object.
 * → { supported:false } | { supported:true, updateAvailable, behind, error? }
 */
async function checkForUpdate(root = REPO_ROOT) {
  if (!isGitClone(root)) return { supported: false };
  const fetch = await run('git', ['fetch', '--quiet'], root);
  if (fetch.code !== 0) {
    return {
      supported: true,
      updateAvailable: false,
      behind: 0,
      error: fetch.error || `Couldn’t reach the update server (git fetch failed: ${fetch.out.slice(-2).join(' ') || 'no output'}). Check your internet connection.`,
    };
  }
  // How many commits the tracking branch is ahead of us. `@{u}` needs an
  // upstream — a clone without one can't auto-update.
  const count = await run('git', ['rev-list', '--count', 'HEAD..@{u}'], root);
  if (count.code !== 0) {
    return {
      supported: true,
      updateAvailable: false,
      behind: 0,
      error: count.error || 'This copy has no upstream branch to update from — re-clone it, or update manually with git.',
    };
  }
  const behind = parseInt(count.out[count.out.length - 1], 10) || 0;
  return { supported: true, updateAvailable: behind > 0, behind };
}

/*
 * Pull + install + build, streaming progress. Steps (renderer's modal shows
 * these four): download (fetch/stash/pull) → install → build → restart (the
 * caller relaunches on ok). Any non-zero exit STOPS the sequence and reports
 * which step failed with the output tail — never a blank error.
 *
 * onProgress(p): { step, label, status: 'start'|'output'|'done'|'failed',
 *                  line?, detail? }   (output lines throttled to ~4/s)
 * → { ok:true, steps } | { ok:false, failedStep, message, output }
 *   | { ok:false, cancelled:true, ... }
 */
async function applyUpdate(root = REPO_ROOT, onProgress = () => {}) {
  if (!isGitClone(root)) return { ok: false, failedStep: 'download', message: 'This copy isn’t a git clone, so in-app updating isn’t available.', output: [] };
  cancelRequested = false;
  cancelable = true;

  // Throttled line stream: at most one 'output' event per 250ms per step
  // (npm install can spew hundreds of lines; the modal only needs a pulse).
  let lastEmit = 0;
  const emitLine = (step) => (line) => {
    const now = Date.now();
    if (now - lastEmit < 250) return;
    lastEmit = now;
    onProgress({ step, status: 'output', line: line.slice(0, 160) });
  };

  const fail = (step, message, out) => {
    onProgress({ step, status: 'failed', detail: message });
    return { ok: false, failedStep: step, message, output: out || [] };
  };
  const cancelledResult = (step, out) => ({
    ok: false,
    cancelled: true,
    failedStep: step,
    message: 'Update cancelled — nothing was rebuilt. You can update again any time.',
    output: out || [],
  });

  // ---- Step 1: download (fetch + defensive stash + ff-only pull) ----------
  onProgress({ step: 'download', status: 'start', label: 'Downloading the new version…' });
  const fetch = await run('git', ['fetch'], root, emitLine('download'));
  if (cancelRequested) return cancelledResult('download', fetch.out);
  if (fetch.code !== 0) {
    return fail('download', fetch.error || 'Couldn’t reach the update server — check your internet connection and try again.', fetch.out);
  }
  // Defensive: testers shouldn't have local edits, but never lose their work.
  // `git stash` only touches tracked files — .env.local/data//.chrome-profile
  // are gitignored and never move.
  const dirty = await run('git', ['status', '--porcelain'], root);
  if ((dirty.out || []).length > 0) {
    onProgress({ step: 'download', status: 'output', line: 'Setting your local edits aside safely (git stash)…' });
    const stash = await run('git', ['stash', 'push', '-m', 'tailor-in-app-update'], root, emitLine('download'));
    if (stash.code !== 0) {
      return fail('download', 'Couldn’t set your local edits aside (git stash failed) — update manually or contact the owner.', stash.out);
    }
  }
  if (cancelRequested) return cancelledResult('download');
  const pull = await run('git', ['pull', '--ff-only'], root, emitLine('download'));
  if (cancelRequested) return cancelledResult('download', pull.out);
  if (pull.code !== 0) {
    // Diverged clone: report, never merge or force (the owner untangles it).
    const diverged = pull.out.some((l) => /fast-forward|divergent|unrelated histories/i.test(l));
    return fail(
      'download',
      diverged
        ? 'Your copy of the app has changes that conflict with the new version. Don’t worry — nothing is broken — but this needs a hand: contact the owner to untangle it.'
        : pull.error || 'Downloading the update failed — check your internet connection and try again.',
      pull.out
    );
  }
  onProgress({ step: 'download', status: 'done' });

  // ---- Step 2: install ------------------------------------------------------
  onProgress({ step: 'install', status: 'start', label: 'Installing dependencies…' });
  const install = await run('npm', ['install', '--no-audit', '--no-fund'], root, emitLine('install'));
  if (cancelRequested) return cancelledResult('install', install.out);
  if (install.code !== 0) {
    return fail('install', install.error || 'Installing dependencies failed (npm install). Send the details to the owner.', install.out);
  }
  onProgress({ step: 'install', status: 'done' });

  // ---- Step 3: build (no cancel from here — a killed build = broken dist) ---
  cancelable = false;
  onProgress({ step: 'build', status: 'start', label: 'Building the app (~10–30s)…' });
  const build = await run('npm', ['run', 'ui:build'], root, emitLine('build'));
  if (build.code !== 0) {
    return fail('build', build.error || 'Building the new version failed. Send the details to the owner — restarting the app will keep running the current version.', build.out);
  }
  onProgress({ step: 'build', status: 'done' });

  return { ok: true };
}

/*
 * Cancel the in-flight update. Only honored before the build step: git pull
 * and npm install re-run cleanly, a killed build leaves dist/ broken.
 */
function cancelUpdate() {
  if (!cancelable) return { ok: false, message: 'The build has already started — let it finish (the app restarts right after).' };
  cancelRequested = true;
  if (currentChild) {
    try { currentChild.kill('SIGTERM'); } catch { /* already gone */ }
  }
  return { ok: true };
}

module.exports = { checkForUpdate, applyUpdate, cancelUpdate, isGitClone, REPO_ROOT };

// ------------------------------------------------------------------ CLI test
if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const rootIx = args.indexOf('--root');
  const root = rootIx >= 0 ? path.resolve(args[rootIx + 1]) : REPO_ROOT;
  (async () => {
    if (cmd === 'check') {
      console.log(JSON.stringify(await checkForUpdate(root), null, 2));
    } else if (cmd === 'apply') {
      const res = await applyUpdate(root, (p) => console.log('  progress:', JSON.stringify(p)));
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.ok ? 0 : 1);
    } else {
      console.log('usage: node ui/updater.js check|apply [--root <path>]');
      process.exit(1);
    }
  })().catch((e) => {
    console.error('updater error:', e.message);
    process.exit(1);
  });
}

# Claude Code prompt — in-app one-click updater (Option B)

Goal: let a non-technical tester update the app **without Terminal** — a button
in the app that pulls the latest code, reinstalls/rebuilds, and relaunches. This
fits the current **git-clone source install** (it does not require packaging or
code-signing). It is a stopgap until a packaged auto-update (electron-updater +
GitHub Releases) is worth the setup.

Paste the block below into Claude Code.

```
Read CLAUDE.md first. Build an in-app "one-click update" feature for this Electron
app. Testers run it from a cloned git repo via `npm run ui:build && npm run ui`,
and updating currently means running git + npm in Terminal. Replace that with an
in-app button. IMPORTANT: check the current committed code before building; this
repo is more advanced than some docs assume, and the Chrome/fill/pipeline layers
are off-limits for this task — this is main-process + renderer plumbing only.

WHAT TO BUILD

1) Main process (ui/main.js) — new IPC, using child_process.spawn (not exec),
   with cwd = the repo root (resolve from __dirname, i.e. the parent of ui/).
   - Resolve the repo root and confirm a `.git` folder exists there. If it does
     NOT (e.g. a future packaged build), the updater is DISABLED — return
     { supported: false } from the check and do not expose the buttons.
   - `update:check` -> runs `git fetch` then compares local HEAD to the tracking
     branch (e.g. `git rev-list --count HEAD..@{u}`); returns
     { supported: true, updateAvailable: boolean, behind: number, error? }.
     Never throws to the renderer — return an error string instead.
   - `update:apply` -> runs, in order, streaming progress:
       a. if the working tree is dirty, `git stash` (defensive — testers
          shouldn't have local edits, but never lose their work),
       b. `git pull --ff-only`  (fast-forward only; if it fails because the clone
          diverged, STOP and return a clear message telling them to contact the
          owner — do NOT auto-merge or force),
       c. `npm install`,
       d. `npm run ui:build`.
     Stream each step + throttled stdout/stderr lines to the renderer over an
     `update:progress` event channel so the user sees it working (builds take
     ~10-30s). If any step exits non-zero, STOP, do not relaunch, and return
     which step failed + the last several output lines.
   - On full success, relaunch: app.relaunch(); app.exit(0). (The next start loads
     the freshly built dist.)
   - Guard: refuse to start an update while a batch import or a fill is running
     (check whatever in-flight state main tracks, or accept a boolean from the
     renderer). Return a clear "finish your current import/fill first" message.

2) preload.js + ui/src/lib/api.ts — expose checkForUpdate(), applyUpdate(),
   onUpdateProgress(cb), each with a mock impl (mock: supported:true,
   updateAvailable:false) so it previews in ui:dev.

3) Renderer UI —
   - A "Check for updates" entry in the app's Settings/Guide menu (or the Home
     header). On launch, run update:check once quietly; if an update is available,
     show a small non-intrusive banner: "A new version is available — Update &
     restart."
   - Clicking Update opens a simple progress modal (steps: Downloading ->
     Installing -> Building -> Restarting) fed by onUpdateProgress, with a Cancel
     that's disabled once building starts. On error, show the failed step + a
     short reason and a "copy details" button so they can send it to the owner;
     never leave them at a blank error.
   - If update:check returns supported:false, hide the whole feature.

CONSTRAINTS
- main-process + renderer only; do NOT touch autofill-driver.js, the pipeline,
  the fill IPC, pricing, or grailed-selectors.json.
- Never modify or read the user's .env.local, data/, or .chrome-profile/ (git
  pull won't; git stash only touches tracked files — those are gitignored).
- git pull is --ff-only; diverged clones are reported, never force-resolved.
- Requires git + npm on PATH (true when launched from Terminal per the setup
  guide). If `git` or `npm` isn't found, surface a clear message rather than a
  crash.

VERIFY
- On a clone intentionally set one commit behind origin, the check shows an update
  and Apply pulls -> installs -> builds -> relaunches into the new version, with
  live progress.
- On an up-to-date clone, the check says "up to date."
- With no `.git` present, the feature is hidden (supported:false).
- .env.local, data/, and .chrome-profile survive an update untouched.
- An update is refused (with a clear message) while an import or fill is running.
- npm run ui:typecheck clean.
```

## Notes for you (not part of the prompt)

- This only works because testers installed via **git clone** with git + Node
  present. It's perfect for the friends beta and nothing more.
- The one real fragility is **PATH**: GUI-launched Mac apps sometimes can't see
  `npm`/`git`. Because your testers launch via `npm run ui` from Terminal, the app
  inherits the Terminal's PATH and this works — but if you ever ship a
  double-clickable launcher, revisit it.
- When the beta outgrows this, do **Option A** (electron-builder + electron-updater
  + GitHub Releases + macOS signing) for true "updates like a real app," and the
  updater above cleanly disables itself (no `.git` in a packaged build).

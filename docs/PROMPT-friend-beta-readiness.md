# Build prompt — friend-beta readiness (first-run clarity + no-headache pass)

Goal: get Tailor Studio ready to put in front of a few **non-technical close
friends who sell on Grailed**, so that (a) they immediately understand the flow
and feel it saves time, and (b) they never hit a dead end, cryptic error, or
developer jargon they can't act on. This is a **UI-first clarity/onboarding
pass** — not new listing functionality.

Grounding: the app already has the hard parts built — batch import, the draft
editor, the Chrome-status chip (`ChromeStatusChip.tsx`), the Home Chrome
precondition row (`ChromeNotifier.tsx`), in-app Launch Chrome / Open Sell form,
the never-submit fill gate, and the circuit breaker. Reuse those (esp.
`useChromeStatus` from `ChromeStatusChip.tsx`) — do not rebuild them. Read
`CLAUDE.md` and `docs/SELLER-WORKFLOW-STRATEGY.md` §6 (trust/onboarding) first.

Target distribution for this beta: a **packaged build with keys pre-configured**,
so a friend just opens the app. Part E below makes the missing-key case fail
gracefully anyway.

## Hard constraints (unchanged)

- The app **never submits** on Grailed; login/captcha stay manual; nothing runs
  unattended; no autonomous bumping/messaging/offers; no fingerprint/UA spoofing.
  Every fix here is copy, orientation, or read-only status — none of it changes
  what the app *does* to Grailed.
- **Do not touch** the driver (`ui/autofill-driver.js`), the pipeline, the fill
  IPC, pricing/grouping math, or `grailed-selectors.json`. The only backend touch
  allowed is Part E: a **read-only** config-status IPC (no secrets returned, no
  side effects).
- Keep the existing safety framing; if anything, make it *more* prominent (it's a
  trust asset for these exact users).

## Part A — First-run orientation ("How Tailor works")

**New:** `ui/src/components/Onboarding.tsx`; wired in `ui/src/App.tsx`.

A one-time welcome shown on first launch (gate on a localStorage flag, e.g.
`tailor.onboarded`), reopenable any time from a small **"?" / How it works**
button in the Home and workspace headers.

Content (plain language, no jargon, studio-blend styling, lucide icons):
- **The 3-step path to your first listing:** ① Import a folder of item photos →
  Tailor drafts titles, prices, and details. ② Launch Chrome and sign in to
  Grailed (you do this yourself). ③ Open a draft, click **Fill**, then review and
  **Publish in Chrome yourself**.
- **What Tailor does / does not do** panel (the trust contract from strategy §6):
  *Does:* organize photos, draft listings, pull sold comps, fill the Grailed form
  when you click. *Does not:* log in for you, submit/publish, bump/offer/message
  on its own, or touch your account when you're away.
- A single primary button: **"Import your first batch"** (calls the same path as
  New batch).

**Accept:** first launch shows it once; dismiss persists; the "?" reopens it; the
primary button starts an import.

## Part B — Home "Get started" checklist (empty / early state)

**File:** `ui/src/components/Home.tsx` (+ optional small `GettingStarted`
component).

When the seller has no items yet (and until their first listing goes live), show
a compact, **live** checklist above the lists — driven by real state, not static:
1. **Import a batch of photos** — done once `items.length > 0`.
2. **Connect Chrome & sign in to Grailed** — reflects `useChromeStatus()`
   (not connected / sign in / ready); reuse the notifier's logic, don't duplicate
   copy. Include the existing Launch / Open-Sell-form actions.
3. **Open a draft and Fill it** — done once any item is `submitted`.

Each row shows a check when satisfied and the relevant one-click action when not.
Once step 3 is satisfied, collapse the checklist (or hide behind the "?"). The
existing `ChromeNotifier` can fold into step 2 rather than sitting separately.

**Accept:** a brand-new user sees a clear "do this next" path that ticks itself
off; an established user with a live listing doesn't see it.

## Part C — De-jargon the remaining developer copy

Sweep user-facing strings for anything a friend can't act on and reword to plain
language + a safe action. Known offenders:
- **Circuit-breaker banner** (`App.tsx`): currently *"Circuit breaker OPEN … (PRD
  §8.1). Review the Grailed account, then remove data/CIRCUIT_OPEN to
  re-enable."* → reword to: *"Pricing and Fill are paused as a safety precaution
  because something looked off with the Grailed account. Nothing was submitted.
  Check the account, then reach out to whoever set this up to re-enable."* (Keep
  the real re-enable step in docs, not in the friend-facing banner.)
- Grep the renderer for `§`, `npm`, `data/`, `.env`, `0b:`, `IPC`, and file
  paths; reword any that reach the UI. (Tooltips too.)

**Accept:** no PRD section numbers, npm commands, env vars, or internal file
paths remain in any visible string or tooltip.

## Part D — Actionable empty & error states

- Home empty rows ("No drafts yet." / "Nothing listed yet.") → add a short next
  step (e.g. *"Import a batch to create your first drafts."*). Keep terse but
  directional.
- Import failure copy (`ImportScreen.tsx` catch): ensure it says what to try, not
  just what broke — and if Part E lands, route missing-key failures to the
  friendly config message rather than a raw error.
- Any raw `errorMessage(err)` surfaced to the user should be prefixed with a plain
  sentence so it never appears as a bare stack-ish string.

**Accept:** every empty state points somewhere; no user-facing error is a bare
technical string.

## Part E — Preflight config check (read-only backend, optional-but-recommended)

The #1 setup headache is a build where keys aren't configured; today that fails
deep in the pipeline with a cryptic toast. Add a **read-only** status probe:
- `ui/main.js`: `ipcMain.handle('config:status', …)` returning **booleans only**
  — `{ hasAnthropicKey: boolean, hasCompsKey: boolean }`. **Never return the key
  values.** No other behavior.
- `ui/preload.js` + `ui/src/lib/api.ts`: expose `getConfigStatus()` (+ mock
  returning both true).
- On app load, if `hasAnthropicKey` is false, show a calm top banner: *"This copy
  isn't finished setting up (missing an API key). Import and drafting won't work
  until it's configured — reach out to whoever shared this with you."* If
  `hasCompsKey` is false, a softer note that pricing/comps will be limited.

**Accept:** a keyless build tells the friend exactly what's wrong in plain words
on launch, instead of failing on first import. Confirm no secret material crosses
the IPC boundary.

## Part F — One-time first-Fill reassurance

**File:** `ui/src/components/DraftEditor.tsx`.

The first time a friend clicks **Fill listing in Chrome** (gate on a localStorage
flag), show a brief one-time confirm reusing the does/doesn't contract: *"Tailor
will type this listing into your Chrome Sell form. It will not submit — you
review and click Publish yourself."* → **Fill** / Cancel. Never show again after
the first confirm. (Does not change fill behavior or the per-item manual-trigger
rule.)

**Accept:** a first-timer gets one calm heads-up before the first fill; repeat
fills are unchanged.

## Part G — Help / Guide menu (in-app reference)

**New:** `ui/src/components/GuideMenu.tsx` (or extend `Onboarding.tsx`); a small
**gear / "?" menu** in the Home and workspace headers opens it. This is the
expanded, reopenable version of Part A — a reference the seller can pull up any
time, organized into collapsible sections (not one long scroll):

- **How it works** — the 3-step flow from Part A.
- **What each screen does** — one short paragraph each: Home (attention / drafts /
  listed / albums), Import (photo folder → drafts), Review (flagged photo
  groups: confirm / split / assign), Draft editor (fields, the readiness
  checklist, price panel), Measure (all drafts in one pass), Finish/triage (only
  the drafts still needing attention — from `PROMPT-ux-streamlining-timesaved.md`
  R2), and Fill + Chrome (Launch → sign in → open Sell form → Fill → you Publish).
- **Keyboard shortcuts** — the full list. **Must be generated from the single
  shortcuts source of truth** (the `shortcuts.ts` module defined in
  `PROMPT-ux-streamlining-timesaved.md` R3), so the guide can never drift from the
  actual key bindings. If R3 isn't built yet, create that module first and have
  both the key handlers and this list read from it.
- **What Tailor does / does not do** — the safety contract (reuse Part A's panel).
- **Troubleshooting** — plain-language fixes: *Chrome not connected* (Launch
  Chrome, sign in), *a field didn't fill* (set it in Chrome; see the fill card's
  reason), *price shows no confidence* (Recompute), *pricing/Fill paused* (the
  safety pause — contact whoever set this up), *nothing works on first import*
  (missing key — Part E).
- **Glossary** — statuses (draft / needs review / listed) and readiness labels
  (ready / needs attention).

Optionally, if a Settings surface is wanted, the same menu can host existing
preferences (theme, default description style, dock preference) with the Guide as
one entry — but keep Settings minimal; the Guide is the point.

**Accept:** the seller can open a single organized reference any time; the
shortcut list matches real bindings (shared source); every entry is plain
language with no internal jargon.

## Verification

1. `npm run ui:typecheck` clean. (`ui:build` may fail off-macOS on the native
   rolldown binary — environmental; build on macOS for the packaged beta.)
2. Mock preview (`ui:dev`) walked as a *first-time friend*: fresh state → sees
   onboarding → get-started checklist → import → drafts → Chrome steps → first-fill
   heads-up → publish → checklist collapses. No jargon, no dead ends.
   Also open the Guide (Part G) from the header and confirm the shortcut list
   matches the real bindings.
3. Part E: run with a key absent (temporarily) and confirm the calm banner, and
   that `config:status` returns only booleans.
4. Confirm no guarded code touched: no changes to driver, pipeline, fill IPC, or
   submit behavior; safety framing intact or stronger.

## Out of scope (do not build here)

- Packaging/electron-builder itself, auto-update, and any hosted key-proxy — those
  are distribution decisions, handled outside this UI pass.
- Any new automation, cross-posting, or inventory features — separate roadmap.

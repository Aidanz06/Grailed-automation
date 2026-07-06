# Grailed Automation — Phase 0b Findings (steps 1–5)

Status date: 2026-07-03
Author: Claude (Phase 0b session)
Scope: PRD §11 Phase 0b, steps 1–5 ONLY. Steps 6–10 (fill logic, dropdowns,
uploads, selectors, screencast) were deliberately NOT started.

## TL;DR

The real-Chrome-over-CDP path cleared every step 1–5 gate **at the
driver-observable level**, with one load-bearing caveat: step 5 cannot rule out
*silent* Runtime-domain detection (§8.5), only network-visible reactions. No red
flags fired, but "no visible flag" ≠ "undetected." Decision on step 6 vs. the
extension-fill alternative is still open and now rests on that caveat.

## Method note (why results are trustworthy)

Built on `chrome-remote-interface` (raw CDP), **not** Puppeteer/Playwright,
because those auto-enable the Runtime domain on connect and would have
contaminated step 5. Nothing was enabled unless explicitly called. Network was
used as a constant observation instrument (steps 4 and 5); Runtime was enabled
only in step 5, as the sole new variable. `Runtime.evaluate` was never called.
No navigator/UA/fingerprint spoofing anywhere (PRD §8.3 honored).

Login state was judged by non-fabricated signals: presence of auth cookies
(`Storage.getCookies`), `/api/users/me` HTTP status (200=in, 401=out) observed
via the Network domain, final URL after navigating to `/sell`, and the presence
of any 403 responses or requests to challenge hosts
(`perimeterx|px-*|captcha|recaptcha|hcaptcha|cloudflare-challenge|human`).

## Results by step

### Steps 1–2 — Launch + manual login — PASS
- Genuine, separately-installed **Google Chrome 150** launched as a detached
  process (survives harness restarts), dedicated persistent profile at
  `<project>/.chrome-profile`, remote debugging on port 9222.
- Launch flags: `--remote-debugging-port=9222 --user-data-dir=<project>/.chrome-profile --no-first-run --no-default-browser-check https://www.grailed.com`
- Explicitly ABSENT: `--enable-automation`, `--disable-blink-features=AutomationControlled`, and any UA/navigator override.
- Stock Chrome UA (`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) … Chrome/150.0.0.0 Safari/537.36`) — no "Electron", no spoofing.
- Human logged in and solved the captcha manually in that window with no reported difficulty — consistent with a genuine browser being trusted.

### `navigator.webdriver === false` — NOT empirically verified (deferred by design)
Reading `navigator.webdriver` requires `Runtime.evaluate`, which would pre-enable
the Runtime domain and destroy step 5's isolation. It is `false` **by
construction** (Chrome only sets it under `--enable-automation`, which was not
passed). Empirical confirmation is deferred to step 6+ and should be treated as
still-unchecked, not proven.

### Step 3 — Session survived "app restart" — PASS
A fresh harness process opened a brand-new CDP connection to the still-running
Chrome (models app-restart-then-reconnect; Chrome itself was not restarted).
Auth cookies persisted in the on-disk profile:
- Present: `grailed_jwt`, `_grailed_session`, `csrf_token` (35 grailed.com cookies total).
- Longest cookie expiry ≈ 400 days.
- Read via `Storage.getCookies` with zero CDP domains enabled.
Caveat: this tests app-restart + reconnect. A full **Chrome process** restart
(close + relaunch same profile) was not separately tested; disk persistence is
implied by the on-disk profile but not independently demonstrated here.

### Step 4 — Session still valid post-CDP-reconnect — PASS
Enabled **Network only** (Runtime NOT enabled). Navigated `/sell` → redirected to
the real form `/sell/new`. Observations:
- `/api/users/me` → **200**
- 403 responses: **none**
- challenge-host requests: **none**
The act of reconnecting CDP and observing did **not** invalidate the session or
trigger a challenge. → The §8.4 (session-to-fingerprint binding on reconnect)
risk did **not** materialize for the reconnect+observe path.

### Step 5 — Enabling CDP Runtime domain — PASS (observable) / UNRESOLVED (silent)
Design: Network held constant; `Runtime.enable()` called as the only new
variable; `Runtime.evaluate` never called; one baseline reload before and one
reload after, on `/sell/new`.

| Signal | Baseline (Runtime off) | After `Runtime.enable` |
|---|---|---|
| `/api/users/me` | 200 | 200 |
| `/api/sign_in` | (none) | (none) |
| New 403s | — | none |
| New challenge hosts | — | none |
| Final URL | `/sell/new` | `/sell/new` |

**No driver-observable change.** No 403, no challenge, no redirect, no session
loss coinciding with `Runtime.enable`.

**CRITICAL CAVEAT — do not record §8.5 as "cleared":**
The known `Runtime.enable` leak is *silent by design*. It exposes a side channel
to **page JavaScript** (execution-context signal), letting an anti-bot script
raise a bot score with **no server-side 403 or challenge** that a network-level
observer can see. This harness observes only network-visible reactions, so it
**cannot** detect silent scoring. The leak could also manifest **later** — at
first form interaction or at listing submission — not on an immediate reload.
Step 5 therefore establishes "no immediate, network-visible reaction to enabling
Runtime," which is necessary but **not sufficient** to declare CDP fill safe.

## New observation (unprompted, worth recording)

**No PerimeterX cookies (`_px`, `_pxvid`, `_pxhd`, etc.) are present** on the
authenticated grailed.com session (checked across all 35 cookies). Combined with
the login-time challenge having been **reCAPTCHA**, this is weak evidence that
the *ongoing* (post-login) session may be gated by **reCAPTCHA Enterprise rather
than a persistent PerimeterX layer**. If true, that is favorable for the CDP
approach. Stated as a data point, not a conclusion — PerimeterX can operate
without long-lived first-party cookies, and this was a single-session
observation.

## Proposed updates to PRD §1.1 validation table

| Capability | Old status | New status (this session) |
|---|---|---|
| Real external Chrome + CDP driver launches and logs in | ❓ Not built | ✅ Launches; human login succeeds in genuine Chrome |
| `navigator.webdriver === false` in real launched Chrome | ❓ Untested | ⚠️ True by construction; empirical check deferred (needs Runtime.evaluate) |
| Session persists across app restart | ❓ Untested | ✅ Cookies persist; valid after fresh CDP reconnect |
| Session persists across CDP reconnect (fingerprint binding, §8.4) | ❓ Untested | ✅ No invalidation on reconnect+observe |
| CDP `Runtime.enable` protocol-level detection avoided (§8.5) | ❓ Untested | ⚠️ No *visible* reaction; *silent* detection UNRESOLVED — see caveat |

Everything below the line in §1.1 (native-setter fill, dropdowns, upload,
selectors, screencast) remains ❓/❌ unchanged — none of it was touched.

## Open issues / what's still unproven

1. **Silent `Runtime.enable` detection (§8.5)** — the decisive unknown. Network
   vantage can't see it. Resolving it needs either a real interaction test over
   time or choosing the extension-fill path to sidestep it.
2. **`navigator.webdriver` empirical value** — deferred; unverified.
3. **Full Chrome-process restart persistence** — only app-restart+reconnect was
   tested, not close/relaunch of Chrome itself.
4. Everything in steps 6–10: native-setter fill on a live field, custom dropdown
   technique, photo upload technique, real selectors, screencast. Untouched.
5. **Delayed / submission-time flagging** — no test yet of whether a flag appears
   at form interaction or listing submission rather than on page load.

## Decision point for next session (not yet decided)

Two candidate step-6 directions, framed by the §8.5 caveat:
- **(a) Minimal CDP probe:** a single read-only `Runtime.evaluate` (confirm
  `navigator.webdriver`, locate the title field), then watch for a delayed/soft
  flag over subsequent navigations. Proves out the CDP fill path if it stays
  clean.
- **(b) Extension-fill prototype:** build the browser-extension content-script
  fill (PRD §8.5 alternative), which uses **zero** CDP Runtime domain, and keep
  CDP for screencast only. Sidesteps the silent-detection risk entirely.

Recommendation deferred to the human; both are viable and the choice hinges on
how much weight to give the unresolved silent-detection risk.

## Current file/folder state

```
~/Desktop/Grailed-automation/
├── phase0b.js            # NEW — CDP harness: launch | check | runtime-test (raw chrome-remote-interface)
├── .chrome-profile/      # NEW — dedicated persistent Chrome profile (holds the login)
├── main.js               # unchanged — old embedded Electron POC (does NOT log in; superseded)
├── package.json          # + chrome-remote-interface dep, + "0b:launch|check|runtime" scripts
├── package-lock.json
├── CLAUDE.md
├── POC-FINDINGS.md       # Phase 0a findings
├── PHASE-0B-FINDINGS.md  # this doc
├── docs/
│   └── grailed-automation-prd.md
└── node_modules/
```
Notes:
- No `preload.js` (was deleted in Phase 0a, stays deleted).
- No fill logic, no selectors config, no screencast code exists yet.
- The Chrome instance launched this session may still be running on :9222 with a
  live logged-in session; the profile at `.chrome-profile` retains login for
  future `node phase0b.js check` runs.
```

### One-line summary for the spec
Phase 0b steps 1–5 validated that a genuine external Chrome driven over CDP
launches, logs in (human/manual), and keeps a valid session across app restart
and CDP reconnect, with no network-visible reaction to enabling the Runtime
domain — but silent `Runtime.enable` detection (§8.5) remains unproven and is the
open question gating whether step-6 fill goes via CDP or via a browser extension.

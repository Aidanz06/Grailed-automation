# Grailed Automation — Phase 0 POC Findings

Status date: 2026-07-03
Author: Claude (Phase 0 session)

## ⚠️ Read this first — scope correction

The Phase 0 POC did **not** reach the state the report template assumes. Two hard facts
gate everything below:

1. **No successful Grailed login was ever achieved.** Every login attempt happened inside an
   **embedded Electron `BrowserView`** and was blocked by Grailed's anti-bot stack. Because we
   never logged in, we never reached the sell page.
2. **The CDP-driver architecture (launch real external Chrome, connect via CDP) was designed and
   mocked, but never built or run.** No Chrome was ever launched by our code.

Therefore, anything downstream of login — session persistence, form injection, dropdown behavior,
file upload, real selectors, screencast — is **NOT TESTED**. Sections below say so explicitly
rather than guessing. Do not treat untested items as validated.

What we actually have:
- Strong **negative** findings: the embedded/Electron approach cannot pass Grailed login.
- A written (but never-executed) native-setter fill script.
- A decision to pivot to a real-Chrome-over-CDP driver (not yet implemented).

---

## 1. Login / anti-bot

**Chrome launch flags — NOT APPLICABLE / NOT BUILT.**
No external Chrome was launched. The CDP driver does not exist yet. The flags below are the
*planned* (unvalidated) design, not a result:
- Planned: dedicated persistent `--user-data-dir` (app-owned profile dir, e.g. `~/Library/Application Support/<app>/chrome-profile`), `--remote-debugging-port`, and **exclude** `--enable-automation` / disable `AutomationControlled` so `navigator.webdriver` stays false.
- **None of this was executed or verified.**

**`navigator.webdriver === false` — verified only in the *embedded Electron* browser, not in a launched Chrome.**
- In the Electron `BrowserView`, `executeJavaScript` returned:
  `{"webdriver":false,"platform":"MacIntel","brands":[{"brand":"Chromium","version":"130"},{"brand":"Google Chrome","version":"130"},{"brand":"Not?A_Brand","version":"99"}]}`
- Caveat: those `brands`/`platform` values were the result of JS overrides we injected (see below), not native. `webdriver:false` is Electron's default. This tells us nothing about a real launched Chrome, which was never tested.

**Anti-bot findings (this is the substantive validated result):**
Grailed's login is protected by a bot-detection stack (behavior consistent with **HUMAN/PerimeterX + reCAPTCHA Enterprise**). `GET /api/users/me` returning 401 pre-login is normal. The blocker is `POST /api/sign_in`. Results by embedded-browser configuration (Electron 33.4.11, Chromium 130):

| Config | Setup | Result |
|---|---|---|
| A | Default Electron UA | `POST /api/sign_in` → **403 immediately** |
| B | Chrome 130 UA (`setUserAgent`) + `Sec-CH-UA` header rewrite (`onBeforeSendHeaders`) | Progressed past instant 403 → reached a **reCAPTCHA image-grid** challenge; challenge **not solvable** (clicks/verify did not progress) |
| C | B + CDP `Page.addScriptToEvaluateOnNewDocument` fingerprint overrides — **but injection timed out, so overrides were NOT actually applied** | Reached a **reCAPTCHA checkbox**; "verify" highlighted but hung; page logged `reCAPTCHA Timeout (d)` / `(g)` |
| D | B + preload `navigator` overrides with `contextIsolation:false` — **overrides confirmed live** via the hygiene-check above | `POST /api/sign_in` → **403 immediately, twice, no captcha offered** — WORSE than B/C |

Key interpretation:
- **JS-level fingerprint spoofing is counterproductive.** Redefining `navigator.userAgentData`/
  `webdriver`/`platform` via getters is itself detectable tampering; Config D (tampering actually
  live) was blocked harder than Config C (tampering failed to install). Do not pursue navigator
  spoofing.
- **UA + `Sec-CH-UA` header alignment helped** (A→B) at the network layer, enough to be *offered* a
  challenge — but the challenge was never solvable in the embedded context.
- Repeated failed attempts from the same IP may have degraded its reputation over the session.
- **Conclusion:** a self-contained embedded (Electron/Chromium) browser cannot clear Grailed's login
  gate. This is the reason for the pivot to driving a real, external Chrome.

**Final code state:** reverted the counterproductive tampering. Current `main.js` keeps only the
honest Chrome 130 UA + `Sec-CH-UA` rewrite, `contextIsolation:true`, no preload. This is still the
embedded approach and still does not log in — it's just the cleanest config, left as-is when we
stopped.

---

## 2. Session persistence

**NOT TESTED — could not be tested.**
- A persistent partition (`session.fromPartition('persist:grailed')`, on-disk) was configured on the
  `BrowserView`, which *should* persist cookies/localStorage across restarts.
- But since **no login ever succeeded**, there was never an authenticated session to persist. The
  restart-survival claim is **unverified**.
- Caveats about cookie expiry / periodic re-auth: **unknown**, not investigated.
- Open note for Phase 1: PerimeterX sessions are often bound to fingerprint/IP. A session
  established in one browser context may be invalidated if replayed from a different context — this
  needs explicit testing once login works.

---

## 3. Form injection

**NOT TESTED on a live Grailed page.** The sell page was never reached (no login).

- **Native-setter + dispatched `input` event technique:** the code exists and is implemented per
  React's known behavior (grab `Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set`,
  call it on the element, then dispatch bubbling `input` and `change` events). It has **never been
  executed against Grailed's actual title field**, so its real-world success is **unverified**. It is
  a sound hypothesis, not a result.
- **Custom dropdowns (designer, size, category, condition):** NOT TESTED. No findings. (Hypothesis
  only — these are typically non-native custom widgets, not `<select>`, and will likely require a
  simulated click / option-selection sequence rather than a value setter. Must be verified.)
- **Photo / file upload field:** NOT TESTED. No findings. (Hypothesis only — programmatic file input
  usually needs a `DataTransfer`-based approach or CDP `DOM.setFileInputFiles`. Unverified.)

---

## 4. Selectors

**NO REAL SELECTORS WERE COLLECTED.** Grailed's sell-page DOM was never inspected (never logged in).

The selectors currently in `main.js` are **unverified guesses / candidate fallbacks only** — do NOT
drop these into a `grailed-selectors.json` as if validated. For the title field, the code tries, in
order:
```
input[name="title"]
input#title
input[placeholder*="title" i]
input[aria-label*="title" i]
input[data-testid*="title" i]
```
No selectors exist for description, price, tags, size, designer, category, or the photo input. These
must all be captured by actually inspecting the authenticated sell page in Phase 1.

---

## 5. Screencast / live view

**NOT BUILT.** Only a static HTML mockup of the intended single-window UI (control panel + live view
of the driven Chrome tab) was produced. No CDP screencast (`Page.startScreencast`) was implemented.
- Rendering correctness: **unknown**.
- Latency / frame-drop / resize behavior: **unknown**.

---

## 6. Open issues

Effectively everything past the login gate is open. Specifically before Phase 1:

1. **Login viability via real Chrome (highest priority, unproven).** Build the CDP driver: launch the
   now-installed Google Chrome with a dedicated persistent profile + remote debugging, *without*
   `--enable-automation`; confirm a human can log in + solve the captcha; verify `navigator.webdriver
   === false` in that real Chrome. This is the make-or-break assumption for the whole product.
2. **Session persistence across restart** — untested (§2).
3. **Native-setter fill on the real title field** — untested (§3).
4. **Custom dropdown handling** (designer/size/category/condition) — technique unknown (§3).
5. **Photo/file upload** — technique unknown (§3).
6. **Real selectors for all fields** — not collected (§4).
7. **CDP screencast in Electron** — not built (§5).
8. **PerimeterX session binding to fingerprint/IP** — needs testing once login works (§2).
9. **Grailed ToS / account-ban risk** for automated listing creation — unresearched, flagged as a
   business/legal risk.

### Current project file structure
```
~/Desktop/Grailed-automation/
├── main.js              # Electron BrowserView POC (embedded approach; does NOT log in)
├── package.json         # electron ^33 devDependency; "start": "electron ."
├── package-lock.json
└── node_modules/        # electron 33.4.11 installed
```
Notes:
- `preload.js` was created (navigator-override experiment) and then **deleted** after it proved
  counterproductive. It is not in the tree.
- No CDP driver, no selectors config, no screencast, no Electron-shell UI exist yet.
- `main.js` contents: single `BrowserView` → `https://www.grailed.com`, `persist:grailed` partition,
  Chrome 130 UA + `Sec-CH-UA` rewrite, the (never-run) native-setter fill script triggered by a
  global shortcut `CommandOrControl+Shift+F`, plus diagnostic logging (navigation, page console,
  failed network responses, load failures).
```
```

### One-line summary for the spec
Phase 0 validated a **negative**: an embedded Electron/Chromium browser cannot pass Grailed's
anti-bot login, and JS fingerprint spoofing makes it worse. The chosen path forward — drive a real
external Chrome over CDP with a human-solved login — is **designed but not yet built or validated**.
All post-login capabilities (persistence, form fill, dropdowns, upload, selectors, screencast) remain
untested and are Phase 1 work.

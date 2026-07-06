# Prompt — new code instance (autofill app integration)

Paste this into a fresh Claude Code session opened in `~/Desktop/Grailed-automation`.

---

You're continuing the Tailor Studio / Grailed automation project. **Read these first,
in order, before doing anything:** `CLAUDE.md` (non-negotiable rules),
`docs/REMAINING-WORK.md` (architecture + full status + the app-integration build
plan), `docs/grailed-automation-prd.md` (§5.5/§6/§8.5 for autofill design + risks),
`grailed-selectors.json` (real selectors + proven techniques), and the reference
probe scripts `phase0b-fill-test.js`, `phase0b-dropdown-probe.js`,
`phase0b-upload-test.js` (these are the *proven* implementations of each fill
technique — reuse their exact in-page expressions).

**Context:** Phase 0b is complete. §8.5 detection is cleared (CDP path confirmed),
and text fill, Radix dropdown open+select, and photo upload are all proven on the
live authenticated `/sell/new` with no detection. Slices 1–5 (read/persist/generate/
price/batch) are wired and working in the Electron app. The "Fill listing" button in
`DraftEditor.tsx` is still a disabled stub.

**Task:** implement autofill (Slice 6) — the app-integration build plan in
`docs/REMAINING-WORK.md`. Build it **incrementally**, verifying each step against a
launched, logged-in real Chrome before moving on:
1. A CDP driver (`ui/autofill-driver.js`) connecting to Chrome on `127.0.0.1:9222`
   (model it on `phase0b.js`'s connection code).
2. Fill primitives reusing the probe scripts' exact expressions: `fillText`,
   `selectDropdown`, `uploadPhotos`.
3. IPC (`autofill:fill`) → `window.tailor.fillListing(id)` → `api.ts` → wire the
   "Fill listing" button.
4. Fill only the proven-safe fields from the selected item: **title, description,
   price, condition** (map condition via `grailed-selectors.json`
   `dropdowns.condition.appValueMap`) **+ photos**. Leave category/size/designer
   MANUAL (they cascade — see `_dependentFieldsPolicy`).
5. Screencast (`Page.startScreencast`) last / optional for v1.

**Hard constraints (from CLAUDE.md — do not violate):**
- The app NEVER submits — the user reviews the filled form and clicks submit in Chrome.
- Never apply navigator/fingerprint/UA spoofing anywhere.
- Before filling, refuse if the §8.1 circuit breaker is open
  (`compGuard.isCircuitOpen()` / `data/CIRCUIT_OPEN` / `RESALE_CIRCUIT_OPEN=1`).
  If the account ever shows a warning/flag, trip the breaker and stop.
- Don't modify `phase0b.js` or root `main.js`. `ui/main.js` is in scope. Additive
  extensions to pipeline modules are OK; don't rewrite their internals.
- Watch the Network domain for 403/challenge after each action; abort + surface if seen.

**Verification:** you can't screenshot the native Electron window — validate driver
logic headlessly where possible, then have the human run `npm run 0b:launch` + log
in, open an item, click Fill listing, and confirm title/desc/price/condition + photos
populate and nothing submits. Keep sessions short (cost).

Start by confirming your understanding of the build plan and the first increment
(CDP connect + `fillText` on the title), then implement that increment.

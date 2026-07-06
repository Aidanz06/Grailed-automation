# Prompt: screencast panel (PRD §5.5) — for a fresh Claude Code instance

Copy-paste everything below the line into a new session.

---

You're continuing the Tailor Studio / Grailed automation project. Read these
first, in order: `CLAUDE.md` (non-negotiable rules + current status),
`docs/REMAINING-WORK.md` (architecture, what's built, priorities),
`ui/autofill-driver.js` (the working CDP driver — model your connection on its
`connect()`), and `docs/grailed-automation-prd.md` §5.5/§6.

**Context:** Slice 6 autofill is COMPLETE and live-verified — the app fills
title/description/price/condition/color/style/country + photos into the
separately-launched real Chrome (`npm run 0b:launch`, CDP on :9222) via the
"Fill listing" button. All fill techniques are documented in
`grailed-selectors.json`. The §8.1 circuit-breaker banner and fill toasts are
done. The screencast is the last §5.5 piece.

**Task:** stream a live view of the driven Grailed tab into the Electron app
(PRD §5.5 "one window" experience), incrementally:

1. **Driver**: add screencast support to `ui/autofill-driver.js` (additive —
   don't disturb the fill primitives): `Page.enable` + `Page.startScreencast`
   ({ format: 'jpeg', quality ~60, maxWidth ~1200, everyNthFrame: 1–2 }),
   listen for `Page.screencastFrame` events, ACK every frame with
   `Page.screencastFrameAck(sessionId)` (frames stop if you don't), expose
   `startScreencast(onFrame)` / `stopScreencast()` on the driver handle.
   Frames arrive as base64 JPEG.
2. **IPC**: long-lived connection in `ui/main.js` (unlike the per-fill
   connect/close): `screencast:start` / `screencast:stop` handlers; push
   frames to the renderer with `webContents.send('screencast:frame', b64)`.
   Handle Chrome-not-running gracefully (same error surfacing as fill).
3. **Renderer**: preload exposes `onScreencastFrame(cb)` (ipcRenderer.on) +
   start/stop invokes; add to `api.ts` (mock: no-op). Panel in the workspace
   view (e.g. a toggleable right-hand pane or a tab) rendering frames into an
   `<img src="data:image/jpeg;base64,...">` — swap src per frame, no canvas
   needed at this frame rate.
4. **Verify each step against the launched Chrome** (`npm run 0b:launch`,
   logged in): a headless CLI mode on the driver that captures N frames and
   reports sizes proves 1; the human confirms the panel visually (you cannot
   screenshot the native window). Renderer changes need `npm run ui:build`
   before `npm run ui`.

**Hard constraints (CLAUDE.md — verbatim rules apply):** the app NEVER submits
(view is read-only; do NOT add click-through/input forwarding in v1); no
navigator/fingerprint spoofing anywhere; refuse/stop if the §8.1 breaker is
open (`pipeline/compGuard.isCircuitOpen()`); selectors stay in
`grailed-selectors.json`; don't modify `phase0b.js` or root `main.js`
(`ui/main.js` IS in scope); watch Network for 403/challenge and stop the cast
+ trip the breaker if seen (reuse the driver's existing signal watch).
Screencast uses only the Page domain on the already-cleared CDP path — no new
detection domains — but the §8.5 silent-detection caveat still applies: keep
test sessions short, and note `Page.startScreencast` itself is a NEW protocol
call not yet exercised against Grailed; treat the first live run as a §8.5-style
probe (watch signals, one run, human-paced).

**After screencast**, the next priority is category/size/designer automation —
see REMAINING-WORK.md §B. Don't start it without reading the
`_dependentFieldsPolicy` note in grailed-selectors.json.

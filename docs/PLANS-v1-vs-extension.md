# Two paths to a finished tool — decision doc

Date: 2026-07-03. Written to choose between finishing the current Electron v1
and pivoting to a Chrome-extension + local-companion architecture. Read
alongside `CLAUDE.md`, `docs/REMAINING-WORK.md`, and `docs/grailed-automation-prd.md`.

## The one thing to understand first

**These plans are not mutually exclusive — Plan A is very nearly a subset of
Plan B.** A codebase audit (2026-07-03) confirms:

- `pipeline/` (store, content, vision, comps, guard, cluster, processItem) has
  **zero Electron imports** — it's already run headlessly by its own CLIs. It
  moves behind a localhost HTTP API essentially unchanged.
- `ui/src/lib/api.ts` already isolates the transport behind an `Api` interface
  with real/mock impls. Swapping the `window.tailor` IPC bridge for a `fetch`
  client is a one-file seam, not a rewrite.
- The fill logic in `ui/autofill-driver.js` is **7 in-page expression strings**
  (`fillExpr`, `openExpr`, `selectExpr`, `acFocusExpr`, …) that port to a
  content script near-verbatim.

What Plan B actually *discards* from Plan A is small: the window-docking glue
(`ui/chrome-dock.js` + `dock:*` in `ui/main.js`, ~150 lines) and the CDP
*connection* layer of the driver. The React UI, the whole pipeline, the fill
techniques, the selectors, and the SQLite schema all carry across.

**Consequence:** "finish v1, then swap the shell" is a legitimate sequencing,
not wasted work. And the hardest remaining feature — category/size/designer
automation — has to be solved either way; the pivot does not buy it.

---

## Plan A — Finish the Electron v1 (docked real Chrome + CDP)

Build on the live-verified foundation. Every technique except the nested
category menu is already proven against the real page.

| # | Milestone | Size | Risk |
|---|---|---|---|
| A1 | **Category/size/designer automation** (track B) | L | High |
| A2 | Fill-progress streaming (per-field IPC events, replace the one ~20s await) | S | Low |
| A3 | Docking polish: re-dock affordance, grailed-tab-not-frontmost detection, new-window/navigation handling, remember manual Chrome size | M | Low |
| A4 | Cross-platform launch: `browser-path.json` (PRD §6) to replace the hardcoded macOS Chrome path in `phase0b.js`; Windows path + profile | S | Low |
| A5 | Nice-to-haves (track D): batch progress streaming, persist raw comps to the `comps` table | S | Low |
| A6 | Hardening + ship: full E2E (start → fill → manual submit), circuit-breaker drill, launch/login/fill README | M | Low |

### A1 detail (the only hard part)
- New ground: the **nested** category menu (Menswear/Womenswear → drill into
  subcategories). Everything else reuses proven primitives — Size is a
  dependent dropdown; Designer is `#designer-autocomplete`, the exact
  Input.insertText + real-mouse-click-on-`li` technique already proven for
  country-of-origin.
- **Cascade risk is why this was deferred:** a wrong category cascades into
  wrong sizes. UX must be **staged confirmation** — app suggests a category
  from attributes, user confirms, *then* size/designer fill. Never blind-fill
  the cascade.
- Read `_dependentFieldsPolicy` in `grailed-selectors.json` before starting.
- Treat the first nested-menu run as a §8.5-style probe (short session, watch
  signals, human-paced), same discipline as every prior slice. Selectors land
  in `grailed-selectors.json`, never hardcoded.

### Plan A trade-offs
- **Pros:** lowest new risk; builds on foundations that already work end to
  end; keeps a shippable tool the entire way; no second process to launch.
- **Cons:** permanently a two-app choreography — docking seams (Spaces,
  fullscreen, Chrome spawning windows) are inherent, not fixable; the fill path
  stays on the **CDP Runtime domain**, i.e. the §8.5 exposure we accepted
  stays; the window resize/feel is only ever "glued," never truly one window.

---

## Plan B — Extension (Side Panel) + local companion app

Chrome MV3 extension whose **Side Panel** hosts the React editor beside the
Grailed form — true native split-screen, user-resizable divider, one window,
one process. Fill via a **content script** (isolated world, no CDP). A local
Node **companion** holds SQLite, the API key, and the pipeline.

| # | Milestone | Size | Risk |
|---|---|---|---|
| B1 | **Companion server**: wrap `pipeline/` behind a localhost HTTP API; move `ui/main.js` handlers to routes (logic unchanged); key stays server-side; CORS + local token locked to the extension | M | Low |
| B2 | **Extension shell (MV3)**: `manifest.json` (side_panel, content_scripts for grailed sell pages, host_permissions, storage); Vite extension build target; side-panel page = the React app; swap `api.ts` bridge → `fetch` client | M | Med |
| B3 | **Content-script fill**: port the 7 in-page expressions; reimplement detection watch via `fetch`/XHR observation → message companion to trip breaker; **photo upload is new ground** (no `DOM.setFileInputFiles` in a content script — needs `DataTransfer` with blobs fetched from the companion) | L | Med |
| B4 | **Split-screen UX**: open panel on user gesture, per-tab enable on `/sell`; optional field-linking (click in panel → scroll/highlight the form field) | M | Low |
| B5 | **Migration + parity**: reuse the same SQLite file via the companion (no schema migration); feature-parity checklist vs v1; keep Electron runnable during transition | M | Low |
| B6 | **Hardening + ship**: E2E + breaker drill, plus MV3 service-worker lifecycle, content-script reinjection on SPA nav, companion-not-running error surfacing | M | Med |

### Plan B trade-offs
- **Pros:** the actual goal — real one-window split screen; resize solved
  natively (user owns the divider, zero code); **drops the CDP Runtime
  domain**, which *is* the §8.5 exposure — the fill becomes a content script,
  the PRD's own named fallback path; more product-shaped.
- **Cons:** genuine re-architecture; two artifacts to build/ship/update; the
  companion must be running (a second thing to launch); MV3 service-worker
  lifecycle friction; **photo-upload-via-content-script is the one primitive
  with no proven equivalent** — needs prototyping first.
- **Rules stay intact:** login/captcha manual in real Chrome (extension lives
  there); content script fills but never submits; no spoofing anywhere.

### Non-negotiable-rule check (both plans)
Neither plan touches login/captcha automation, neither submits, neither adds
spoofing, both honor the §8.1 breaker. Plan B additionally *reduces* protocol
risk by removing CDP from the fill path.

---

## Recommendation

**Sequence, don't choose: do A1 now, then B.**

1. **Land A1 (category/size/designer) on the current v1 first.** It's the one
   feature both plans need, it's the highest-risk item, and it's cheapest to
   prove on the CDP path you've already cleared. Skip A2–A5 for now (docking
   polish is throwaway under Plan B; the nice-to-haves aren't blocking).
2. **Then execute Plan B as a shell swap**, reusing the pipeline, the fill
   expressions (now including category), the selectors, and the React
   components. Prototype the content-script photo upload (B3) early — it's the
   only unknown — before committing to the full port.

If you'd rather not re-architect at all: **Plan A standalone is a complete,
shippable tool** — accept the docking seams and the CDP fill path as the cost.
If the two-window seams already bother you (they prompted this question), the
sequence above gets you the finished feature set *and* the real one-window
experience, with the A1 work carried forward rather than thrown away.

The only path I'd argue against is **Plan B before A1** — you'd be standing up
the whole new architecture while the hardest feature is still unproven, mixing
two kinds of risk in one step.

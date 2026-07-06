# Tailor Studio — Remaining Work & Handoff

Date: 2026-07-03
Self-contained handoff so a fresh session (or cowork) can continue without
re-deriving anything. Read alongside `CLAUDE.md` (non-negotiable rules) and
`docs/grailed-automation-prd.md` (full scope/risks; note the PRD is the real file,
`CLAUDE.md`'s `@docs/PRD.md` import path is stale).

---

## Architecture (what talks to what)

```
Electron app (ui/)
├── ui/main.js        main process (CommonJS). IPC handlers, loads .env.local,
│                     opens SQLite store, registers tailor-photo:// protocol.
├── ui/preload.js     contextBridge → window.tailor.{listItems,getItem,saveItem,
│                     markSubmitted,generateContent,recomputeComps,pickBatchFolder,
│                     processBatch}
└── ui/src/           React 19 + Vite + TS renderer
    ├── lib/api.ts    the data layer: window.tailor if present, else MOCK_ITEMS.
    │                 Holds store→UI adapters (adaptItem, toUiRange, adaptDescParts).
    ├── App.tsx        state (items), loads via api.listItems() + reloadItems()
    ├── components/    Home, Sidebar, Editor, DraftEditor, PricePanel, DetailPanel,
    │                  PhotoRow, ImportScreen, ReviewScreen
    └── types/index.ts shared Item/Photo/ListingContent/PriceRange/DescParts/…

pipeline/ (Node CommonJS — the real backend, required by ui/main.js)
├── store.js          SQLite via node:sqlite (§7 schema). saveItemRun, getItem,
│                     listItems, saveItemEdits, markSubmitted, addFlag/resolveFlag.
├── vision.js         extractAttributes + describePhoto (Anthropic vision).
├── cluster.js        groupBatch/clusterPhotos (photo grouping, §5.1).
├── content.js        generateContent (Anthropic) → title/desc/tags/disclaimers/desc_parts.
├── priceProvider.js  GrailedScrapeProvider / MockCompProvider (Algolia sold comps).
├── compGuard.js      GuardedCompProvider — cache + rate-limit + circuit breaker (§8.1).
├── range.js          computeRange (relevance-weighted price range).
└── processItem.js    per-item flow; makeCompProvider (provider choice + fallback).

phase0b.js            CDP harness (chrome-remote-interface, :9222). launch/check/
                      runtime-test/probe. Launches real Chrome w/ .chrome-profile.
phase0b-*.js          probe/test scripts written during Phase 0b (reference impls).
grailed-selectors.json  externalized sell-form selectors + proven techniques (§7.1).
data/resale-studio.db   local SQLite.
.env.local            ANTHROPIC_API_KEY, GRAILED_ALGOLIA_KEY (export KEY=val format).
```

**Commands:** `npm run ui` (Electron app) · `ui:dev` (Vite/browser, mock fallback) ·
`ui:build` · `ui:typecheck` · `pipeline` / `pipeline:batch` · `0b:launch|check|
runtime|probe|form|fill|dropdown|upload`.

**IPC pattern to follow for any new capability:** `ipcMain.handle('x:y', …)` in
`ui/main.js` → expose in `ui/preload.js` on `window.tailor` → add to the `Api`
interface + real/mock impls in `ui/src/lib/api.ts` → call from a component.
Keys live in main only, never the renderer.

## Non-negotiable rules (from CLAUDE.md — do not violate)

- Never apply navigator/fingerprint/UA spoofing anywhere (§8.3 — confirmed worse).
- Login/captcha is manual, by a human, in the real launched Chrome. Never in Electron.
- The app NEVER submits the Grailed form. User reviews + clicks submit.
- If the account gets any warning/flag: trip the circuit breaker (§8.1) — disable
  scraping + autofill, fall back to manual — rather than probing the boundary.
- DOM selectors live in `grailed-selectors.json`, never hardcoded.
- Do NOT modify `pipeline/*` internals gratuitously, `phase0b.js`, or root `main.js`.
  (Additive extensions to store.js/content.js for features are fine, as done for
  saveItemEdits + desc_parts.)

---

## Done

- **Slices 1–5 wired + confirmed in the native app:** read-only IPC; persist edits
  (debounced auto-save); regenerate content (Anthropic); recompute price/comps
  (guarded live Grailed, §8.1 breaker respected); batch intake (folder picker →
  cluster → process → save).
- **Structured description parts:** `content.js` emits `desc_parts`; they +
  `measurements` persist in `content_json` (no schema migration), map via the
  adapter, drive the detail selector. Empty text sections are hidden; measurements
  prompt clarified. Items generated before this need a **Regenerate** to get parts.
- **UI polish:** human-readable timestamps (`formatWhen`), real photo thumbnails
  (`tailor-photo://` protocol in main + `Photo.src`), green "Saved Ns ago" indicator.
- **Env fix:** Electron 33 → 43 (bundled Node has `node:sqlite`). Do NOT downgrade.
- **Phase 0b autofill validation — COMPLETE:** see below.

## Autofill (Slice 6) — BUILT + LIVE-VERIFIED (2026-07-03)

Everything below in this section is done except screencast. What exists:

- **`ui/autofill-driver.js`** — CDP driver (:9222, connection modeled on
  phase0b.js). Primitives: `fillText` (native setter), `selectDropdown`
  (Radix, locates triggers by placeholder OR current value label, idempotent,
  CDP-mouse-click fallback), `uploadPhotos` (DOM.setFileInputFiles per slot,
  S3 POST = success), `fillAutocomplete` (country: REAL typing via
  Input.insertText + REAL mouse click on the suggestion li — free text and
  synthetic events do NOT work). High-level `fillListing(fields)` maps + fills
  title/description/price/condition/color/style/countryOfOrigin/photos.
- **Guards:** refuses when the §8.1 breaker is open; every action is followed
  by a network-watch gate that trips the breaker + aborts on 403/challenge/
  logout. Never submits. No spoofing.
- **Wiring:** `autofill:fill` + `autofill:options` IPC in ui/main.js →
  `window.tailor.fillListing/getAutofillOptions` → api.ts (mock fallbacks) →
  "Fill listing" button + Color/Style/Country fields in DraftEditor.tsx
  (persist as optional attributes_json fields: grailed_color, grailed_style,
  country_of_origin; blank = skipped).
- **Condition mapping:** appValueMap covers BOTH the UI's and vision.js's
  vocabularies, matched case-insensitively (grailed-selectors.json).
- **CLI test modes:** `node ui/autofill-driver.js fill-title|dropdown|country|upload`.
- **Caveats:** fill is human-paced (~15–20s full run). Filled values live in
  the form only — Grailed restores its last SERVER-saved draft on reload, so
  the user must Save as Draft/Publish in Chrome to persist. Renderer changes
  need `npm run ui:build` (Electron loads ui/dist).

**"One window" experience (step 6) — WINDOW DOCKING, BUILT 2026-07-03.**
A screencast panel was built + live-verified first (8 frames off /sell/new, no
detection), then ROLLED BACK the same day by user decision in favor of window
choreography: the app snaps the REAL Chrome window flush against its own and
keeps it glued on move/resize. `ui/chrome-dock.js` (`connectDock()`) drives it
over a browser-level CDP connection — `Browser.getWindowForTarget` +
`Browser.setWindowBounds` + `Target.activateTarget` — cross-platform (macOS +
Windows), no Accessibility API, no page script, nothing page-observable, no
input forwarding; the user interacts/submits in genuine Chrome so the
manual-submit rule holds by construction. Wiring: `dock:start/stop` IPC in
ui/main.js (only the initial dock sizes Chrome — fill to the work-area edge,
shrinking the app if Chrome would get <480px; afterwards the user owns
Chrome's size and app move/resize only REPOSITIONS it, debounced 120ms;
pushes `dock:stopped` if Chrome quits) →
`window.tailor.startDock/stopDock/onDockStopped` → "Dock Chrome" toggle in the
workspace header (App.tsx). Not gated on the §8.1 breaker (window management,
not scraping/autofill). Verified: `node ui/chrome-dock.js snap` moved the live
Chrome window to exact requested bounds and back; typecheck/build/boot clean;
mock-mode toggle verified. In-app docking still needs a human eyes-on pass.

### Original validation notes (Phase 0b)

§8.5 cleared: enabling `Runtime.enable` (`0b:runtime`) and one `Runtime.evaluate`
(`0b:probe`) both caused **no visible detection**, `navigator.webdriver=false`.
Path = **CDP** (not the browser-extension fallback). Every technique below was run
against the live authenticated `/sell/new` with **no 403/challenge/logout**
(silent-detection caveat §8.5 always applies — trip the breaker on any flag).

| Field type | Technique (proven) | Reference script |
|---|---|---|
| Text (title/price/description) | native value setter + dispatched `input`+`change` (plain `el.value=` is ignored by React) | `phase0b-fill-test.js` |
| Flat dropdown (condition) | locate trigger by text → dispatch `pointerdown`+`pointerup` (NOT `.click()`) → options are `role=menuitem` in `role=menu` → select by text → re-read trigger by session id | `phase0b-dropdown-probe.js` |
| Photo upload | `DOM.setFileInputFiles` on `#photo_input_0..8` → Grailed POSTs to grailed-media.s3.amazonaws.com and clears the input (`files:0` is normal; the S3 POST is the success signal) | `phase0b-upload-test.js` |
| Form inventory | read-only `Runtime.evaluate` DOM dump | `phase0b-form-probe.js` |

Real selectors + techniques + condition value-map are in `grailed-selectors.json`.

**Dependent dropdowns → leave MANUAL in v1.** Category is a NESTED menu (top level
Menswear/Womenswear → drill into categories); Size/Subcategory/Designer are disabled
until a category is chosen and repopulate from it (Designer = autocomplete
`#designer-autocomplete`). Cascading + a wrong category cascades badly → v1 autofills
title/description/price/condition + photos and leaves category/size/designer to the
user (staged confirmation). See `grailed-selectors.json` `_dependentFieldsPolicy`.

### App-integration build plan (the remaining work for a code session)

Incremental; verify each step against the launched Chrome before the next.

1. **CDP driver** (new file, e.g. `ui/autofill-driver.js`, CommonJS). Model the
   connection on `phase0b.js`: `getJSON('/json')` on `127.0.0.1:9222`, find the
   `type==='page'` target whose url matches grailed, `CDP({ target })`. Enable
   `Network` for the §8.1 detection watch; use `Runtime.evaluate` for fill/dropdown,
   `DOM.setFileInputFiles` for photos. Load `grailed-selectors.json`. NEVER spoof.
2. **Primitives** (reuse the exact expressions from the probe scripts):
   `fillText(sel, value)`, `selectDropdown(triggerText, optionText)`,
   `uploadPhotos(paths[])`. Watch Network for 403/challenge after each; abort +
   surface if seen.
3. **Value mapping:** condition via `grailed-selectors.json` `dropdowns.condition.appValueMap`;
   price = digits only; title/description straight; photos = item.photos file paths.
4. **IPC + button:** `ipcMain.handle('autofill:fill', (_e,id)=>…)` reads the item
   from the store, maps fields, drives the connected Chrome. Expose `fillListing(id)`
   on `window.tailor`; add to `api.ts` (real → bridge; mock → no-op/log). Wire the
   currently-disabled **"Fill listing"** button in `DraftEditor.tsx` to it. On
   success, toast "filled — review + submit in Chrome". Handle "Chrome not
   running/logged in" gracefully.
5. **Circuit breaker:** before filling, refuse if the §8.1 breaker is open
   (`compGuard.isCircuitOpen()` / `data/CIRCUIT_OPEN` / `RESALE_CIRCUIT_OPEN=1`).
   The app still never submits.
6. **Screencast (last):** `Page.startScreencast` → stream frames to a renderer
   panel so the driven tab shows inside the app (PRD §5.5). Optional for v1.

Verification: drive the real Chrome (`npm run 0b:launch` + manual login), open an
item, click Fill listing, confirm title/desc/price/condition + photos populate and
NOTHING submits. The assistant can't screenshot the native window — human confirms.

---

## Remaining tracks (priority order)

### A. ~~"One window" experience~~ DONE 2026-07-03 (PRD §5.5)
Shipped as window docking (`ui/chrome-dock.js`); the screencast built from
`docs/PROMPT-screencast.md` was rolled back same-day in favor of it (see
"'One window' experience (step 6)" above — that brief is now historical).

### B. Category/size/designer automation — IN PROGRESS (A1, started 2026-07-03)
The biggest remaining manual step, and the one feature BOTH the finish-v1 and
the future extension plan require (see `docs/PLANS-v1-vs-extension.md` — the
agreed sequence is: land this on v1 first, then swap to the extension shell).
Deferred from Slice 6 v1 because of the cascade risk (wrong category cascades
into wrong sizes), NOT because it's infeasible — the country-of-origin work
PROVED the autocomplete technique the designer field needs (real
Input.insertText typing + real mouse click on the suggestion li; see
grailed-selectors.json). New ground is only the nested category menu
(Menswear/Womenswear → drill in). Recommended shape: staged confirmation — app
suggests category from attributes, fills size/designer only after the user
confirms it.
Progress (2026-07-03):
- **Nested-category mechanism PROVEN** via `phase0b-category-probe.js` — it's an
  in-place two-click drill (open → click department → same menu re-renders into
  categories → click category → menu closes, trigger reads "Dept / Cat", and
  subcategory/size/designer flip enabled). Not a hover submenu. Full technique +
  the Menswear category tree are in `grailed-selectors.json` (`category`).
- **`driver.selectNestedCategory(department, category)` BUILT + live-verified**
  (`ui/autofill-driver.js`, CLI: `node ui/autofill-driver.js category [Dept]
  [Category]`). Handles both open states (unset → department level; already-set
  → category level), is idempotent (skips when the label already matches), and
  refuses a cross-department change on an already-set field (no proven back
  control — asks the user to clear it in Chrome). Zero detection across all runs.
- **CASCADE COMPLETE (2026-07-03)** — all three increments built + live-verified
  end-to-end through the production `fillListing` path (category → size →
  sub-category → designer, one connection, zero detection):
  1. **Size**: option labels are COMPOUND ("US M / EU 48-50 / 2") — the driver
     matches the anchored "US {size} /" form first (raw "S" would substring-hit
     "US XS…"), falls back to raw text. Bottoms sizes normalize to waist digits
     in ui/main.js ("32x30" → "32").
  2. **Sub-category + designer**: `selectDropdown` / `fillAutocomplete` worked
     as predicted ("Carhartt" persisted via the country technique). Sub-category
     matches by substring — vague app values hit the FIRST match ("T-Shirt" →
     "Long Sleeve T-Shirts"); the fill result reports what was clicked.
  3. **Staged-confirmation UX** (DraftEditor "Grailed category" card):
     suggestion from `lib/grailedCategory.ts` (subcategory-first keyword map),
     LOUDLY labeled ("suggestion — not filled until you confirm", shows what it
     was based on + exactly what confirming unlocks). Confirm sets
     `attributes.grailed_department/grailed_category` — the gate `ui/main.js`
     checks before passing ANY cascade field to the driver. Change clears them.
     Verified in mock preview: suggestion → confirm → change round-trip, plus
     mapping breadth (Carhartt jacket → Outerwear, Levi's 501 → Bottoms).
  - Driver hardening found live: disabled triggers/inputs are now reported as
    "trigger is disabled" (they silently swallow clicks — a page reload resets
    an unsaved category, disabling the cascade fields); every dropdown open is
    preceded by Escape (a lingering-open menu makes the trigger click toggle it
    shut).
  - **Sub-category/designer fill bug FIXED 2026-07-04** (user-reported, live
    item #5 "Supreme graphic tee"): three compounding causes. (1) The
    pipeline's free-text subcategory ("graphic t-shirt") matches no Grailed
    option — new `appValueRules` in grailed-selectors.json (per confirmed
    category; Tops list captured live) translate it in ui/main.js before the
    fill; unmatched values still pass through raw. (2) A failed option match
    left the Radix menu OPEN, so the designer autocomplete typed into nothing —
    selectDropdown/selectNestedCategory now Escape on every failure path and
    fillAutocomplete Escapes before focusing. (3) Designer suggestions are a
    network lookup that took ~2s (900ms fixed wait failed) — fillAutocomplete
    now polls up to ~4s. Regression run live: raw value fails cleanly with the
    available list, designer "Supreme" fills right after (ok:true), mapped
    "Short Sleeve T-Shirts" fills; zero detection signals.
  - **Remaining for A1**: a human eyes-on pass in the app (native window), and
    the first real listing published through the full confirmed-cascade flow.
    Womenswear's category list in grailed-selectors.json is best-effort,
    unverified — check it on the first Womenswear item.

### C. AI vision optimization — HARDENED 2026-07-04 (clustering-integration-plan executed)
Research/decision (cowork) + engineering hardening both COMPLETE. Default =
`batched-vision`, fallback = `descriptor-improved`, `groupBatch` contract
unchanged. Do NOT re-benchmark without new data. What landed:
- **P0.1** `sharp` in dependencies — verified loading + encoding INSIDE Electron
  (N-API prebuilt; no electron-rebuild needed). Downscale no longer depends on
  macOS `sips`/ImageMagick.
- **P0.2** `groupBatch` now auto-falls-back (primary fails → descriptor-improved,
  `meta.fallbackFrom/fallbackReason` recorded; both fail → one structured error);
  `batch:process` try/catches and the ImportScreen toasts the actionable message
  + a non-fatal `groupingNotice` when the fallback ran. Live-drilled.
- **P0.3** Large-shoot guard: >75 photos (`CLUSTER_MAX_PHOTOS`, default 75) →
  batched-vision refuses (SHOOT_TOO_LARGE, thrown BEFORE any API call — verified
  with an 80-file folder and no key in env) → fallback runs per-photo. Anthropic
  caps ~100 imgs/32MB. DECIDED 2026-07-04: keep the graceful per-photo fallback
  (not a hard "split into ≤75 folders" stop) — the fallback holds P=1.0 and the
  UI shows a groupingNotice; a strict stop is one line (`fallbackStrategyName:
  false`) if a real big shoot ever misgroups.
- **P1.4** `batch:progress` IPC stream → ImportScreen progress bar (indeterminate
  during the grouping call, determinate per-group after; the user-requested feature).
- **P1.5** `singleton_review` flag + concrete review reasons + numeric grouping
  confidence in ReviewScreen; Home labels/attention filters updated.
- **P1.6/P2.7** `npm run clustering:gate` — offline regression gate (fails if
  descriptor-improved P<1.0 or wrong-AA>0). No CI (not a git repo) — run it
  before shipping pipeline changes. Env knobs documented in clustering-gate.js.
- **P2.8** `grouping_events` telemetry table + `store.logGroupingEvent` recorded
  per batch (strategy, fallback, per-group confidence/flags). Correction events
  deferred until review split/merge exists (still stubs).
Verified: offline harness P=1.00/wrong-AA=0; live fallback drill (guard → haiku
descriptor run, $0.007); live benchmark + 5-run stability re-run clean.
Re-verified 2026-07-04 (finish+verify pass): live harness with the final
1024-adaptive downscale + EXIF timestamps → P=R=1.00, 9/9 exact, wrong-AA=0,
$0.24; stability 5/5 identical perfect partitions; sharp re-proven inside
Electron 43 (ABI 148). Background-import UX fixed the same day: App.onImported
reads nav state at COMPLETION time (navRef) so a finished background import
never yanks the user off a listing (Q6 jump only fires if still on the Import
screen), and a remounted ImportScreen re-attaches to a running batch's
`batch:progress` stream (shows the live checklist, disables starting a second
batch; terminal state clears after 2.5s). Remaining eyes-on: import a real
60–75-photo folder in the app and watch the top strip while navigating.
Real-run feedback round (2026-07-04, first 38-photo batch, all built +
preview-verified):
- Comps → real links: `open:external` IPC (https + grailed.com hostname
  allowlist → shell.openExternal), comp rows in PricePanel are buttons with
  hover underline + ExternalLink icon; rows without a URL render disabled.
- Post-import SUMMARY screen in ImportScreen (replaces the Q6 auto-jump):
  counts line, grouping/processing notices, per-group rows (draft/review
  badge, title/signature, error) with Open buttons + "Start with the first
  draft" / "Import another folder". Result cached module-side so it survives
  navigating away and back mid-/post-run.
- Authenticity note removed from listing text: content.js prompt now bans any
  authenticity mention in the body (caveats live only in the seller-facing
  disclaimers array) + stripAuthenticityLines() sentence-level scrub as a
  backstop (exported, unit-tested). Existing drafts: hit Regenerate once.
- Photo layout streamlined: 240×192 thumbnail left, remaining photos as
  116×116 tiles wrapping beside it (2 rows ≈ thumbnail height — no dead band).
- OWNER DECISION — auto-select cascade + color: DraftEditor adopts the
  category suggestion automatically when it validates against the live
  category tree, and maps primary_color onto Grailed's color list. Both stay
  editable (Change / selects); ui/main.js's gate is unchanged (only values
  set in the app are passed to the driver). Manual picker still appears when
  there's no confident suggestion.
413 FIX 2026-07-04 (found by the first real-shoot import): the grouping call
downscales but `vision.js extractAttributes` sent an item's photos FULL-RES
(3 phone photos ≈ 48MB b64 → 413, no fallback on that path) and
`cluster.js describePhoto` could 413 on any single photo > ~3.4MB (5MB/image
cap). Both now downscale via the shared ladder (1568px start — API-optimal,
keeps tag text legible; describePhoto only touches oversized files so the
benchmarked path is byte-identical). Stub-client verified: 3×12MB in →
0.92MB/image out, temps cleaned. Also: one group failing in `batch:process`
no longer aborts the whole import — it's parked in Review with a
`processing_failed` flag carrying the real error (confirm re-runs the
pipeline), and the toast appends a processingNotice. clustering:gate green.

### D2. UI optimization (UX review execution) — IN PROGRESS 2026-07-04
Source: `docs/UX-REVIEW-listing-workflow.md`. Agreed order: trust pass → S1 →
S5 → S3 → rest.
- **Trust pass DONE:** Q1 persistent "NOT saved on Grailed" banner after fill
  (dismissed only by "I saved it in Chrome" or switching items); Q5
  descParts/measurements now included in the markSubmitted + fill-flush saves
  (closed a silent-loss bug); Q2 every "see console" replaced with the real
  error via `lib/utils.errorMessage()` (IPC wrapper stripped); Q3 dead
  "Check Grailed messages" stub, demo toggle, and "mock data" subtitles removed;
  size-unclear warning now tracks the AI's uncertainty even when a size is set.
  Mock fillListing now simulates success so the post-fill UI is previewable.
- **S1 ReviewScreen DONE:** flagged groups can finally leave the queue —
  confirm-as-one-item (runs processItem, updates the item IN PLACE via new
  store.updateItemRun, resolves flags → draft), split selected photos into a
  new review group (store.createReviewItem + movePhotos), assign selected to an
  existing item; empty source items auto-delete. Every action records a
  `grouping_events` correction row (§5.6 — user fixes are clustering ground
  truth). New IPC: review:confirm/split/assign. Store methods tested headless
  against a temp DB; UI verified in mock preview.
- **Checklist-rail redesign DONE 2026-07-04** (user-directed, mock-inspired):
  DraftEditor is now two-column — form in the middle (with helper notes; price
  panel/actions removed from the flow), sticky right rail with (1) a computed
  readiness checklist (`ListingChecklist.tsx`: n/7 required rows + verify/
  optional rows, click-to-jump via section ids, "app never submits" footer),
  (2) the estimated-price card (`PricePanel.tsx` rewritten: big editable price,
  comps-trend SVG sparkline, compact expandable comps list), (3) actions card
  (Fill listing in Chrome / Copy / Mark submitted) + the Q1 not-saved banner.
  Rail stacks below the form under 1024px window width (docked-shrunk case).
- **Accurate batch-grouping progress DONE 2026-07-04:** grouping strategies
  emit `opts.onProgress` (per-photo `prepare` counts + opaque `analyze` for
  batched-vision; per-photo `describe` for descriptor paths; `fallback`
  notice) — listener errors can't break grouping. ui/main.js streams these as
  new BatchProgress stages (preparing/analyzing/describing); ImportScreen shows
  a 3-step checklist (prepare → AI grouping → price+write) over a weighted bar
  (0–15/15–55/55–100%), with a slow CSS creep during the single vision call.
  clustering:gate re-run clean after the pipeline touch.
- **S5 counterfeit-ack gate SKIPPED for v1** (user decision 2026-07-04: app is
  personal-use; the `counterfeit_risk` flag still surfaces in disclaimers).
  Revisit before any distribution/multi-user use (PRD §8.8).
- **S3 fill-progress streaming DONE 2026-07-04:** `fillListing(fields,
  onProgress)` emits a transport-agnostic event stream (designed for reuse by
  the future extension shell): one `{kind:'plan', fields[]}` up front, then
  `{kind:'field', field, status: filling|ok|failed|skipped, done?/total?
  (photos slots), reason?}` bracketing every field; listener errors never
  break the fill. ui/main.js forwards as `autofill:progress`;
  `FillProgressCard.tsx` renders a live rail checklist (rows tick as fields
  actually fill, per-slot photo counts, failed rows show the driver's reason,
  card persists as "Last fill" until the next run/item switch). Live-verified
  against the launched Chrome (plan → filling → ok; zero detection signals);
  mid-run states verified in mock preview.
- **Larger photos + sidebar identification DONE 2026-07-04** (user-directed):
  DraftEditor photo tiles enlarged (thumbnail 240×192 — visibly the lead
  photo; others 150×120); Sidebar rows now show a 64px photo-1 thumbnail with
  a photo-count chip, two-line titles at 14px, sidebar column 300→320px.
- **Studio-blend retheme DONE 2026-07-04** (user-directed after a 3-option
  mock comparison: studio-tool base + editorial "class"): tokens rewritten in
  ui/src/index.css — champagne-brass primary (no more stock shadcn blue),
  deep cool dark default, glassy alpha hairline borders, teal success,
  warm-paper light mode. Self-hosted fonts via @fontsource (Space Grotesk =
  UI, JetBrains Mono = data/counts, Instrument Serif = wordmark + big price).
  All emoji/ASCII glyphs (⏳⬇⤴↻◉○＋✓✗–→▸) replaced with lucide icons.
  Motion system in ui/src/components/motion.tsx + index.css utilities:
  AnimatedCheck (stroke draws in), LiveDot (glow pulse), ProgressBar
  (teal→brass gradient, glow, shimmer while live), PhotoShuffler (batch
  loader — photo cards shuffling into a stack, replaces the hourglass),
  rise-in staggered entrance on item switch, button press-scale, sidebar
  brass selection bar. Respects prefers-reduced-motion. Verified in preview
  (home / editor / import run / fill run).
- **Q6/Q4/S6/status-vocab DONE 2026-07-04** (closes the UX-review list):
  Q6 — after an import the app now selects the first new draft (falling back
  to the first review group, then Home) instead of dumping to Home;
  onImported carries the BatchResult with item ids. Q4 — items without
  descParts get an explanatory note in the Description section with a
  one-click Regenerate (mock items all have descParts, so verify against the
  real pre-descParts DB items). S6 — "Mark listed" (renamed) now arms an
  inline confirm ("Did you actually publish this on Grailed?…") and only
  "Yes — it's live on Grailed" persists. Status vocab — sidebar badge for
  submitted items now reads "listed", matching Home's "Currently listed on
  Grailed"; toasts updated. All UX-review items are now done or
  deliberately skipped (S5).
- **Workflow round DONE 2026-07-04** (4 features, preview-verified;
  real-run pending):
  1. *Albums* — `albums` table + `items.album_id` (try/catch ALTER
     migration, verified against a simulated pre-albums DB: old items
     read back `album_id = null`); `batch:process` creates one album per
     import (`<folder> — <date>`); `albums:list`/`albums:setHidden` IPC;
     Home hides hidden-album items from all three lists behind an
     "Albums — past imports" section (counts incl. "N to review" so
     hiding unreviewed work is visible; nothing deleted).
  2. *Listed→fill-next* — post-fill banner button "I published — fill
     next draft": saves, marks listed, advances to the next draft in
     sidebar order, and starts its fill. One click per item = the manual
     trigger (constraint intact: never submits, never infers Chrome
     state). Secondary button relabels to "I only saved a draft in
     Chrome" when a next draft exists.
  3. *Measurement templates + batch measure* — `ui/src/lib/
     measurements.ts` maps category → fields (tops/bottoms/dresses/
     footwear/accessories; `measureKind` regex over grailed_category +
     free-text category/subcategory); `Measurements` is now
     `Record<string, string>` (store round-trip of arbitrary keys
     verified); DraftEditor grid + Copy listing use the template; legacy
     chest/… values still render as extra fields. Home → "Measure"
     opens MeasureScreen: every draft's blanks in one tabbable table,
     debounced autosave via the normal saveItem path.
  4. *Streamed drafts* — each saved group is announced on
     `batch:progress` (`item` field); App reloads items incrementally so
     the sidebar fills during the run, and ImportScreen shows a "Start
     editing" card for the first draft mid-import (import continues in
     background; summary unchanged).
  Verified: ui:typecheck + ui:build clean, node --check on
  store/main/preload, store unit tests (album counts/hide/delete/
  migration + measurements round-trip), full preview pass (hide/show
  toggle 8→5 rows, measure table with per-category fields + Saved badge,
  mid-run Start-editing card, fill→publish→auto-fill-next chain across
  two items).
- **Real-run fix round #2 DONE 2026-07-04** (LV light-jacket test):
  1. *Deleted photo still uploaded by autofill* — root cause: photo
     deletes/reorders only lived in renderer state; `saveItemEdits` had
     no photos support, and the driver reads photos from the DB. Fixed
     end-to-end: `photos.position` column (try/catch migration),
     `getItem` orders by `COALESCE(position, id)`, `saveItemEdits`
     accepts `photos` (ids in display order → deletes missing rows, sets
     position; foreign ids ignored; omitted = untouched), and EVERY
     DraftEditor save (debounce/mark-listed/fill-flush/publish-next) now
     sends the photo list via `editsOf()`. Since fill flushes a save
     first, the driver can no longer see a stale set — and drag-reorder
     now really controls upload order (position 1 = thumbnail). Store
     tests cover delete+reorder, foreign-id, delete-all, omit.
  2. *"Louis Vuitton" designer reported not found* — most likely cause:
     `#designer-autocomplete` is disabled until a category is chosen and
     Grailed enables it ASYNC after the category click; fillAutocomplete
     failed instantly on 'input is disabled'. Now polls up to ~4s while
     disabled; suggestion matching + the final value check normalize
     NBSP/whitespace/case; failures carry a precise reason ("value after
     click was …"), and the DraftEditor toast now includes per-field
     reasons instead of a bare "problems with designer". Needs a live
     re-test to confirm.
  3. *"light jacket" garment type unfillable* — grailed-selectors.json
     appValueRules only covered Tops; added an Outerwear block
     (bombers/denim/leather/parkas/raincoats/vests/heavy coats + a
     light-jackets fallback for windbreaker/coach/harrington/shell/
     generic jacket). Labels are best-effort (not captured live) — a
     wrong one still fails cleanly listing Grailed's actual options.
     The AI's free-text `subcategory` accuracy itself is a model
     behavior — watch it over the next runs before touching the vision
     prompt.
- **Haiku 4.5 cost experiment DONE 2026-07-04** — verdict: MIX (content
  only). Compat: Haiku 400s on `thinking: adaptive` → added
  `supportsThinking`/`thinkingConfig` to cluster.js (exported), spread
  into vision.js + content.js requests (Opus keeps adaptive thinking).
  Numbers on the 36-photo/9-item ground-truth set:
  - Grouping: batched-haiku matched Opus on ONE run (P=R=1.00, 9/9,
    wrong-AA=0; $0.048 vs $0.242, 16s vs 26s) but stability 5× showed
    2 distinct partitions and wrong-AA=1 in 2/5 runs → fails the hard
    invariant. CLUSTER_MODEL stays Opus.
  - Attributes: Haiku $0.010/item vs Opus $0.068/item, but 2/9 items
    had real errors (AMI joggers size "US M" vs tagged L; PSG jersey
    extracted as "soccer jacket" → wrong Outerwear auto-category) and
    brand_confidence pegged ~0.95 everywhere (kills the low-confidence
    badge). Opus 0/9 errors. ATTRIBUTE_MODEL stays Opus.
  - Content: Haiku $0.003/item vs Opus $0.018/item; all 9 titles/
    descriptions clean given correct attributes (condition vocab like
    "like new" already maps via the driver's appValueMap).
    CONTENT_MODEL=claude-haiku-4-5-20251001 is now LIVE in .env.local.
  - Net: ~$0.85 → ~$0.70 per 38-photo import (~18%). All-Haiku would be
    ~$0.17 but is blocked by grouping instability + attribute errors.
  clustering:gate passed after the pipeline edits; mixed config
  smoke-tested live (Opus thinking intact, Haiku content generates).
- **Comp-link fix + estimate confidence DONE 2026-07-05**:
  (a) Comp rows rendered unlinked because computeRange stripped `url`
  from mostRelevantComps — range.js now keeps it, and adaptRange
  backfills legacy items by joining ranked comps against the raw comps
  rows on price + sold date (verified 20/20 across the real DB).
  (b) `computeRange` now emits `confidence` (owner request): level
  high/medium/low from near-duplicate matches (per-comp relevance ≥0.75
  = same-item sale), demoted for wide spread (cv>0.45) or thin
  effective sample (Kish nEff<2.5); `ci95` = normal-approx interval on
  the MEDIAN (σ from weighted IQR / √nEff) — "where the going rate
  sits", not min–max. PricePanel shows the badge + "likely $lo–$hi" +
  explanation ("5 near-identical sold listings; tight price spread").
  Unit-tested: duplicates→high/narrow, loose comps→low/wide, one close
  match→medium, <3 comps→low. CAVEAT: the comps TABLE stores no
  title/condition/size, so stored-range items show no badge until
  Recompute (cache-served recompute keeps full comp objects → informed
  confidence, no extra Grailed traffic).
- **Chrome status probe + fresh-Sell-form fill gate DONE 2026-07-05**
  (docs/PROMPT-chrome-status-and-fresh-sell.md, audit §3.1/§3.2):
  `ui/chrome-status.js` `getChromeStatus()` classifies the launched
  Chrome from ONE HTTP GET of :9222/json/list — no WebSocket to a page
  target, no Runtime.enable, no page script (statusFromTargets is pure
  + unit-tested on 9 tab-list shapes; CLI `node ui/chrome-status.js`).
  URL patterns live in grailed-selectors.json `sellForm` (sell-form +
  login routes; loggedIn=false only from a public login-route URL —
  the probe never reads cookies). Exposed as `chrome:status` IPC →
  ChromeStatusChip in the workspace header (4s poll while mounted:
  not connected / Open a Sell form / Sign in to Grailed / ready).
  DraftEditor gates every fill on the probe: a manual fill that finds
  Chrome not ready is blocked with a persistent warning card (Recheck
  / Fill anyway override); the listed→fill-next chain only auto-fires
  onto a fresh Sell form — otherwise the fill button ARMS ("Chrome
  ready on a new Sell form? — Fill this draft"), keeping the one
  manual click per item and never pouring a draft into item N's
  published page. Probe is passive w.r.t. the §8.1 breaker. Part E
  de-jargon: `npm run 0b:launch` removed from user-facing copy (fill
  helper line + Dock tooltip). Verified: ui:typecheck clean; live CLI
  against the real Chrome (correct "connected, not on Sell form" on
  the LV listing tab); mock preview walked ready fill, blocked fill,
  Recheck, Fill anyway, and the armed publish-next chain. LIVE
  three-state re-test (incl. a real fill→publish→next run) awaits the
  user's eyes-on pass.

### D. Nice-to-haves
- ~~Circuit-breaker banner~~ DONE 2026-07-03 (App.tsx polls `guard:status` every 60s).
- ~~Batch progress streaming~~ DONE 2026-07-04 (per-stage events incl. per-photo prep/describe from inside the strategies — see §D2).
- Persist raw comps list (`comps` table) on recompute, not just the range's top-5.
- ~~Fill-progress streaming~~ DONE 2026-07-04 (S3 — see §D2).

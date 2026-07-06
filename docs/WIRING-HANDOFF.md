# Tailor Studio — UI ↔ Pipeline Wiring Handoff

Date: 2026-07-03
Purpose: hand this to a fresh session so it can wire the React UI to the real
`pipeline/` modules with full context headroom. **Start on a cheaper model
(`claude-sonnet-5` or `claude-opus-4-8`) — Fable 5 is overkill/expensive for
this work.**

Also read: `CLAUDE.md` (non-negotiable rules) and `docs/grailed-automation-prd.md`
(note: `CLAUDE.md`'s `@docs/PRD.md` import is a stale path — the real PRD file is
`docs/grailed-automation-prd.md`). Prior findings: `POC-FINDINGS.md`,
`PHASE-0B-FINDINGS.md`.

---

## TL;DR
Everything is built and validated EXCEPT the UI is still on hardcoded mock data.
Wire the UI to `pipeline/`. Do it in slices; **start with Slice 1 (read-only IPC)**.
Autofill ("Fill listing") stays a STUB — gated on §8.5, unchanged.

## Current state
- **`pipeline/` (Node, done + validated on a real item):** `vision.js` (attributes),
  `priceProvider.js` + `compGuard.js` (live Grailed Algolia sold comps, cached/
  rate-limited/circuit-breaker), `range.js` (relevance-weighted price), `content.js`
  (title/desc/tags/disclaimers), `store.js` (SQLite via `node:sqlite`, §7 schema),
  `cluster.js` (batch photo grouping), `processItem.js` (shared per-item flow),
  `cli.js` / `batch-cli.js` / `drafts-cli.js`.
- **UI (`ui/`, React 19 + Vite + TS + Tailwind + shadcn, done, MOCK ONLY):** home
  landing (`Home.tsx`) + workspace (`Sidebar` + `Editor`/`DraftEditor` + sub-
  components), theme toggle (light/dark), description-detail selector. All state in
  `App.tsx` over `MOCK_ITEMS`.
- **Phase 0b:** real-Chrome CDP driver validated steps 1–5; **§8.5 silent-detection
  is the open gate** for autofill (steps 6–10). User is monitoring via
  `node phase0b.js check`.

## Architecture for wiring
`pipeline/` is Node (SQLite, Anthropic SDK, Algolia HTTP) → it runs in the **Electron
main process**. The React renderer is a thin client that talks to main over **IPC**.

- Add `ui/preload.js` — `contextBridge.exposeInMainWorld('tailor', { listItems, getItem, ... })`
  backed by `ipcRenderer.invoke`.
- In `ui/main.js` — set `webPreferences.preload`, and add `ipcMain.handle(...)` handlers
  that `require('../pipeline/...')` and call the modules. (`ui/main.js` is CommonJS;
  `pipeline/*` are CommonJS `require`-able. Import them; never modify them.)
- Renderer data layer: add `ui/src/lib/api.ts` that uses `window.tailor` if present,
  else falls back to `MOCK_ITEMS`. **Keep the mock fallback** so the browser preview
  still renders for layout work. `App.tsx` loads items from `api` (useEffect) instead
  of seeding `MOCK_ITEMS` directly.
- Keys live in the **main process env only** (never renderer): `.env.local` already has
  `ANTHROPIC_API_KEY` and `GRAILED_ALGOLIA_KEY`. Have `ui/main.js` load `.env.local`
  (simple parse or set env before launch).

## The slices (do in order; each is a checkpoint)
1. **Read-only IPC** — `listItems`/`getItem` from `store` → Home + editor show real
   saved drafts. No API cost. Foundation. **Start here.**
2. **Persist edits** — save title/description/tags/price + "mark submitted" back to
   `store` (extend `store.js` write methods as needed).
3. **Generate content** — `Regenerate` → `content.generateContent` (Anthropic).
4. **Price/comps** — recompute via `GuardedCompProvider` + `range` (needs
   `GRAILED_ALGOLIA_KEY`); show real comps.
5. **Batch intake** — `+ New batch` → Electron `dialog.showOpenDialog` folder picker →
   `cluster.groupBatch` → process auto-accept groups → save; needs-review groups surface
   in Home's "Needs your attention".
6. **Fill listing** — STAYS A STUB (autofill gated on §8.5). Do not wire.

## Slice 1 concrete steps
1. `ui/preload.js`: expose `tailor.listItems()` and `tailor.getItem(id)`.
2. `ui/main.js`: `webPreferences: { preload: path.join(__dirname,'preload.js'), contextIsolation:true, nodeIntegration:false }`; `ipcMain.handle('items:list', () => openStore().listItems())` and `('items:get', (_e,id) => openStore().getItem(id))` (open once, reuse). `require('../pipeline/store')`.
3. `ui/src/lib/api.ts`: `export const api = (window as any).tailor ?? mockApi;` where `mockApi` wraps `MOCK_ITEMS`. Add an `adaptItem(storeItem): Item` mapper (see below).
4. `App.tsx`: `useEffect(() => { api.listItems().then(setSummaries) }, [])`; load full item via `api.getItem(id)` on selection. Keep `updateItem` local for now (persistence is Slice 2).
5. Verify: `node -e` against `store` to confirm data exists; `npm run ui:build && npm run ui` to click through the real Electron app. Seed data if empty: `node pipeline/batch-cli.js grailed-vision-test --run`.

## Data adapter: `store.getItem()` → UI `Item`
`store` shape → UI type (`ui/src/types/index.ts`):
- `created_at` → `createdAt`; `listing.submitted_at` → `submittedAt`; `status` already matches (`draft|needs_review|grouped|submitted`).
- `attributes_json` → `attributes`; `listing.content_json` → `content` (has title/description/tags/disclaimers); else fall back to `listing.{title,description,tags}`.
- `listing.price_range` → `range`; `comps` rows (`{source,sold_price,sold_date,url}`) → `Comp{price,soldDate,...}` if you populate `range.mostRelevantComps` from them.
- `photos` are **file paths** (`{file_path, cluster_confidence}`), NOT `{tint,label}`. For Slice 1, map `label = basename`, `tint = placeholder`; real thumbnail rendering (file:// or a custom protocol / data-URL over IPC) is a later polish.
- **Store schema GAPS** (not persisted yet): `descParts`, `measurements`, `descProfile`. Map to `null`/defaults for now → the description-detail selector only renders when `descParts` exists, so real items just show the raw description. Fill these in when wiring Slice 2/3 (extend `store.js`), or derive.

## Commands
- `npm run ui:dev` — Vite dev server (browser preview / hot reload; mock fallback).
- `npm run ui:build` — build to `ui/dist`.
- `npm run ui` — launch the Electron app (loads `ui/dist`; this is where real wiring is tested).
- `npm run ui:typecheck` — `tsc --noEmit`.

## Constraints / do-not-touch
- Do NOT modify `pipeline/*` internals, `phase0b.js`, or the **root** `main.js` (embedded-POC). Import pipeline modules; don't edit them.
- `ui/main.js` (the shell's Electron host) IS in scope — add preload + IPC there.
- Autofill stays stubbed until §8.5 resolves.
- Never put API keys in the renderer.

## Verification
- Main-process logic (IPC handlers, adapters): test via `node -e`/small scripts calling `pipeline/` directly (as the CLIs do).
- Renderer/layout: browser preview with mock fallback.
- Real end-to-end: `npm run ui` (the assistant can't screenshot the native window — the human clicks through).

## Cost note
This project has been expensive partly due to long single sessions + running on
Fable 5. For wiring: use `claude-sonnet-5` or `claude-opus-4-8`, keep sessions
short/per-slice, avoid re-reading large docs.

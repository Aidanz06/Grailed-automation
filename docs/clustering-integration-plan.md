# Implementation plan — harden the photo-clustering path (for the code instance)

**Scope:** take the validated batch-clustering work from "prototype proven in `pipeline/`"
to "production-hardened feature in the app." The *approach is already decided and measured*
(see `docs/clustering-optimization-results.md`) — this plan is engineering hardening, **not**
re-research. If you meant a broader project plan (e.g. autofill §B category/size/designer),
that's `docs/REMAINING-WORK.md`, not this.

**Owner handoff from:** the clustering research/benchmark work (Cowork instance).
**Decision already locked:** default grouping strategy = `batched-vision` (single multimodal
call), fallback = `descriptor-improved`. Live 36-photo/9-item result: P=1.00, R=1.00, 9/9 exact,
0 wrong auto-accepts, 1 call, ~$0.24/batch; stability 5/5 identical partitions. Do **not**
re-benchmark or swap the default without new data.

---

## What is ALREADY wired (do not rebuild)

- `pipeline/cluster.js#groupBatch(folder, opts)` → picks a `GroupingStrategy` (default
  `batched-vision` via `DEFAULT_STRATEGY` / `$GROUPING_STRATEGY`). Returns the stable shape
  `{ photoCount, groups, descriptors, meta }`, `group = { groupId, photos[], signature,
  confidence, autoAccept, flags }`.
- `pipeline/groupingStrategy.js` — the provider abstraction: `BatchedVisionStrategy`,
  `DescriptorJaccardStrategy` (baseline + improved), `EmbeddingStrategy` (Voyage / local CLIP),
  dependency-free EXIF reader, agglomerative clustering, conservative auto-accept.
- `ui/main.js` `ipcMain.handle('batch:process', …)` (≈L98): calls `groupBatch`, then for each
  group auto-accepts → `processItem` → `store.saveItemRun(status:'draft')`, else
  `saveItemRun(status:'needs_review')`. Returns `{ photoCount, groups, drafts, review, processed }`.
- `preload.js` exposes `processBatch(folder)` / `pickBatchFolder()`; `ImportScreen.tsx` calls them.
- `pipeline/store.js` persists `photos.cluster_confidence` and `flags(type, detail, resolved)`.
- `ReviewScreen.tsx` / `Home.tsx` render flag details and the `needs_review` queue
  (`low_confidence_group`, `multi_item_photo`).
- Test/verify tooling: `pipeline/harness.js` (offline fixtures + `--live`),
  `run-clustering-benchmark.sh`, `run-stability-check.sh`, ground truth +
  `descriptors.fixture.json` (36 photos / 9 items).

**So the feature runs end-to-end today.** The gaps below are robustness, edge cases, and UX.

---

## Invariants — must not break

1. `groupBatch` return shape and the `group` object shape above (UI + store depend on them).
2. **Conservative auto-accept:** never auto-accept a group mixing ≥2 real items. `wrong-AA`
   must stay 0 on the harness. When unsure, flag (`needs_review`), don't accept.
3. The app **never submits** to Grailed; clustering only ever produces drafts / review items.
4. New API keys live in `.env.local` and are read only in the main/CLI path
   (`groupingStrategy.js`) — never in the renderer.
5. Keep `descriptor-improved` working as a fallback (it needs no resizer and no single-request
   size limit).

---

## Tasks (priority order)

### P0 — robustness (ship-blockers for relying on batched-vision by default)

- [ ] **1. Cross-platform image resize.** `BatchedVisionStrategy` downscales each photo before
  batching (fixes the request-size 413). `downscaleToTemp` currently prefers `sharp`, then macOS
  `sips`, then ImageMagick. There is **no image dependency in `package.json`**, so today it only
  works where `sips`/ImageMagick happen to exist. Add **`sharp`** to `dependencies`, and run
  `electron-rebuild` (or `@electron/rebuild`) so the native module matches Electron's ABI in the
  packaged app.
  *Why:* removes reliance on a system binary; works off-macOS and in a packaged build.
  *Where:* `package.json`, electron build config. (`groupingStrategy.js` already uses sharp first.)
  *Accept:* on a box with no `sips` and no ImageMagick, `node pipeline/harness.js --live
  --strategies=batched-vision` completes; packaged app groups a folder successfully.

- [ ] **2. Error handling + automatic fallback around grouping.** `batch:process` does
  `await groupBatch(folder)` with no try/catch — an API error, a 413 on a huge shoot, malformed
  JSON, or a missing resizer throws to the renderer as an unhandled rejection. Add a fallback:
  attempt `batched-vision`; on **any** failure, log and retry with `descriptor-improved`; if that
  also fails, return a structured error the UI can toast. Best implemented as a `fallbackStrategy`
  option inside `groupBatch` (keeps the contract) with `batch:process` wrapping the whole thing in
  try/catch.
  *Where:* `pipeline/cluster.js` (`groupBatch` fallback), `ui/main.js` (`batch:process` try/catch),
  `preload.js` + `ImportScreen.tsx` (surface the error).
  *Accept:* force a batched failure (e.g. bad model id) → app still returns groups via the
  fallback and shows a non-fatal notice; no unhandled rejection.

- [ ] **3. Large-shoot guard.** The batched call sends *all* photos in one request. Anthropic caps
  ~100 images/request and ~32 MB payload; even downscaled, a very large shoot will 413. Add a
  threshold (start ~60 photos) to `BatchedVisionStrategy`: above it, either **fall back to
  `descriptor-improved`** (per-photo, no single-request limit) or **chunk** the shoot and merge
  group ids. Simplest safe version: fall back. Document the cap.
  *Where:* `pipeline/groupingStrategy.js` (`BatchedVisionStrategy.group`), maybe `groupBatch`.
  *Accept:* a 120-photo folder groups without a 413 (via fallback or chunking).

### P1 — UX & observability

- [ ] **4. Progress feedback for `batch:process`.** It's a long, multi-stage op: one ~25 s grouping
  call, then per auto-accepted group a full `processItem` (attributes → comps → content = several
  calls each). Today the renderer just awaits and toasts at the end. Emit progress
  (`webContents.send('batch:progress', { stage, done, total })`) and show it in `ImportScreen`
  ("grouping…", "pricing item 3/9…").
  *Where:* `ui/main.js`, `preload.js`, `ImportScreen.tsx`.
  *Accept:* user sees live stage/counts, not a frozen spinner.

- [ ] **5. Explain *why* a group is flagged — including lone photos.** `ReviewScreen` shows flag
  detail and a generic "low-confidence group" fallback. Two improvements: (a) show the numeric
  `cluster_confidence`; (b) give **singleton** `needs_review` groups a specific message — a lone
  photo is usually a fragment, so prompt "single photo — confirm it's its own item or merge it."
  Optionally emit a `singleton_review` flag from `assembleGroups` (in `groupingStrategy.js`) so the
  UI can message precisely instead of inferring from `photos.length === 1`.
  *Where:* `pipeline/groupingStrategy.js` (optional flag), `ui/src/components/ReviewScreen.tsx`,
  `Home.tsx` (`FLAG_LABELS` / `ATTENTION_FLAGS`).
  *Accept:* every `needs_review` group states a concrete reason.

- [ ] **6. Config surface.** `$GROUPING_STRATEGY` and `$CLUSTER_MODEL` are already respected. At
  minimum document them; ideally add a small settings control to switch `batched-vision ↔
  descriptor-improved` and pick the model, for quick fallback without an env edit.
  *Where:* `.env.local` docs (done) + optional settings UI + a `grouping:config` IPC.
  *Accept:* switching strategy at runtime needs no code edit.

### P2 — durability

- [ ] **7. Regression + stability gates.** Add an `npm` script that runs the **offline** harness
  and fails if `descriptor-improved` regresses on the fixtures (`P < 1.0` or `wrong-AA > 0`), and
  wire it into pre-commit/CI. Re-run `run-stability-check.sh` after any change to the batched-vision
  prompt/model. Keep `ground-truth.json` + `descriptors.fixture.json` updated as new shoots are added.
  *Where:* `package.json` scripts, CI config.
  *Accept:* CI fails on an intentional clustering regression.

- [ ] **8. Misgrouping telemetry (§5.6).** Log grouping outcomes and, when the user later
  splits/merges/reassigns a group in review, record the correction. This turns real-world use into
  data for tuning thresholds and catching drift (the honest caveat: batched-vision is validated on
  one shoot).
  *Where:* `pipeline/store.js` (a small `grouping_events` table or reuse `flags`), the review edit path.
  *Accept:* you can query how often auto-accepted groups were later corrected.

---

## Verification checklist (run before calling it done)

- `node pipeline/harness.js` → `descriptor-improved` P=1.00, wrong-AA=0 (offline gate).
- `./run-clustering-benchmark.sh` → `batched-vision` leads, wrong-AA=0.
- `./run-stability-check.sh` → `distinct partitions: 1`, 0 wrong-AA.
- Manual: drop a real folder in the app → correct per-item groups, flagged groups explained,
  drafts priced, nothing submitted.
- Force-fail path: break the batched call → app falls back to `descriptor-improved` gracefully.

## Out of scope / already decided

- Strategy choice (`batched-vision`) and thresholds are settled; don't re-benchmark without new data.
- No new API key needed. `embedding-voyage` / `embedding-clip` stay available but unused unless
  batched-vision proves unstable on future shoots.
- Autofill field coverage (category/size/designer) is separate — see `docs/REMAINING-WORK.md §B`.

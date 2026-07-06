# Build prompt — non-blocking fill + global fill indicator

Let the user keep working on other drafts while a "Fill listing in Chrome" run
is in flight (~20–30s), and show a **global** indicator of that run so it's never
lost when they navigate away. Background: `docs/UX-AUDIT-inputs.md` §3.1 and the
fill flow in `DraftEditor.tsx`. This is **UI/state-layer only** — the fill IPC
already runs in the main process against the real Chrome; nothing here touches
the driver, pipeline, or `ui/main.js` fill logic.

## The actual problem

The fill already runs async in the main process, so the app UI is not truly
blocked. But the fill's state (`filling`, `fillRun`, `fillOutcome`) lives inside
the mounted `DraftEditor`, and a `useEffect` on `item.id` **resets it on item
switch**. So navigating to another draft mid-fill wipes the progress card and —
worse — the post-fill "NOT saved on Grailed / publish-next" banner, even though
the fill keeps running in Chrome. Fix = lift the fill lifecycle above the editor
and surface it globally.

## Hard constraints (unchanged)

- **One fill at a time.** There is a single Chrome sell form; never start a
  second fill while one is running. This is a guard, not a queue — do **not**
  auto-advance or background-queue fills (each item stays a manual per-item
  trigger; the user must review + Publish in Chrome between items).
- The app **never submits**; the existing publish-next / mark-listed flow and its
  single manual click per item are preserved exactly.
- Don't change what gets filled or how (driver, selectors, IPC fill handler,
  `autofill:progress` stream are all as-is). This task only relocates and
  globalizes the **renderer state** around the fill.
- Keep the auto-fill-next chain working (publish item N → advance to N+1 →
  N+1's fill fires) — it just routes through the new app-level controller.

## Part A — lift fill state to App level

**Files:** `ui/src/App.tsx`; optionally a new `ui/src/lib/fill.ts` (a small
controller hook `useFillController`) and `ui/src/lib/item.ts` (move `editsOf`).

- Move `editsOf(item)` out of `DraftEditor.tsx` into a shared module so both the
  editor and the controller can compute the pre-fill save flush.
- Create an app-level fill controller holding:
  ```
  activeFill: { itemId: number; title: string; filling: boolean; run: FillRunState } | null
  outcomes:   Record<number, string[]>   // per-item post-fill "filled fields"; drives the not-saved banner, persists across navigation
  ```
- Subscribe to `api.onFillProgress` **once** at App level (not per editor) and
  fold events into `activeFill.run`.
- Expose:
  - `startFill(itemId)` — refuses if `activeFill?.filling` is true (one at a
    time); computes `editsOf` from the current item in App state, does
    `api.saveItem` → `api.fillListing(itemId)`, sets `filling` true then false,
    writes the result into `outcomes[itemId]`, and fires the same toasts the
    editor does today.
  - `isFilling(itemId)` / `anyFilling` selectors.
  - `dismissOutcome(itemId)` — clears `outcomes[itemId]` (used by "I saved it in
    Chrome" and by publish-next/mark-listed).
- Starting a fill clears that item's own prior `outcomes[itemId]` first.

## Part B — DraftEditor consumes the controller

**File:** `ui/src/components/DraftEditor.tsx`.

- Remove the local `filling` / `fillRun` / `fillOutcome` state and the
  `item.id`-reset effect that wipes them. Read this item's fill view-state from
  the controller instead (`isFilling(item.id)`, the run when `activeFill.itemId
  === item.id`, and `outcomes[item.id]`).
- `Fill listing in Chrome` button → calls `controller.startFill(item.id)`.
- The auto-fill-next `autoFill`-on-mount effect → calls `startFill(item.id)`
  (same single-trigger semantics).
- The not-saved banner + publish-next/mark-listed read `outcomes[item.id]` and
  call `dismissOutcome` where they currently `setFillOutcome(null)`. `FillProgressCard`
  renders the controller run for this item.
- **Because outcome now persists per item**, returning to a filled-but-not-yet-
  published draft still shows its not-saved banner and publish-next button.

## Part C — global fill indicator

**Files:** `ui/src/App.tsx`, optionally `ui/src/components/FillIndicator.tsx`.

- When `activeFill` exists, render a compact indicator visible across views
  (home / workspace / measure) — same persistent-strip spirit as
  `BatchProgressBar`. Show the item title and progress, e.g. **"Filling *Carhartt
  jacket* — 4/9 fields"** with a thin `ProgressBar` (reuse `motion.tsx`
  primitives; studio-blend tokens, no emoji).
- Clicking it selects that item and opens the workspace (so the user can jump
  back to review/publish). After the run settles, it can linger briefly as "Last
  fill: *title*" or collapse into the per-item banner; keep it lightweight.
- This is what makes leaving the editor safe: the run is always visible and its
  outcome is preserved.

## Part D — one-fill guard + "keep working" affordances

- While `anyFilling` is true, other items' **Fill listing** button is disabled
  with a clear reason: *"A fill is already running in Chrome — finish it there
  first."* (The auto-fill-next chain never overlaps because it only fires after
  the prior item is published, so it isn't affected.)
- Everything else stays interactive: the user can open other drafts, edit fields,
  confirm categories, recompute price, or enter Measure mode while a fill runs.
- Editing the **currently-filling** item is allowed but won't change the
  in-flight run (it already flushed a save). If low-effort, show a subtle note on
  that item while it fills: *"This draft is filling in Chrome — edits apply to the
  next fill."* Optional.

## Verification

1. `npm run ui:typecheck` clean. (`ui:build` may fail off-macOS on the native
   rolldown binary — environmental, ignore.)
2. Mock preview (`ui:dev`): start a fill, navigate to another draft mid-run —
   confirm the global indicator keeps showing progress, the other draft is fully
   editable, and a second Fill is disabled with the reason. Return to the first
   draft — its not-saved banner + publish-next are still there.
3. Confirm the auto-fill-next chain still works across two items
   (fill → publish-next → next item's fill fires via the controller).
4. Confirm no fill state is lost on unmount/remount and that only one fill can be
   in flight.
5. Reconfirm constraints: no second concurrent fill, no auto-queue, app never
   submits, one manual click per item preserved, driver/IPC untouched.

## Notes

- Pairs naturally with `docs/PROMPT-chrome-status-and-fresh-sell.md` (the fill
  gate) — if both land, `startFill` should still respect the fresh-Sell-form
  check before running.
- Keep the diff focused: the win is *relocating* state, not rewriting the fill.

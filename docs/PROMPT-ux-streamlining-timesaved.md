# Build prompt — UX streamlining for time saved (batch throughput pass)

Goal: make a real batch (10–40 items) go from imported → all listed **faster**,
by cutting the two remaining time sinks — reviewing many drafts one at a time,
and losing your place in the per-item fill loop. This is a **throughput/
streamlining pass**, not onboarding and not new listing features.

Grounding: the app already drafts everything from a photo dump, has batch Measure,
a combined category picker, autofocus, the Chrome status chip, and a one-click
"fill next" chain. Reuse the editor's readiness logic (`ListingChecklist.tsx`
`buildRows`) and `useChromeStatus`. Read `CLAUDE.md` first.

## Hard constraints (unchanged)

- The app **never submits**; **fill stays one manual click per item** — bulk
  *edit* is allowed, bulk *fill* is not, and no autonomous chaining beyond the
  existing single-click fill-next.
- **Nothing is guessed.** Bulk edit may set only seller-judgment fields
  (condition, tags, description style, album); **never** blindly bulk-set size,
  measurements, or a price *value* across items.
- Do **not** touch the driver (`ui/autofill-driver.js`), pipeline, fill IPC,
  pricing/grouping math, or `grailed-selectors.json`. This is renderer/state work.

## Part R1 — Sidebar readiness triage board

**Files:** extract a `readiness(item)` helper (e.g. `ui/src/lib/readiness.ts`)
from `ListingChecklist.tsx` `buildRows` so the editor and sidebar share one
source of truth; `ui/src/components/Sidebar.tsx`.

- Each sidebar row gets a compact readiness chip: **Ready** (all required rows
  done) or the top blocker (e.g. *confirm category*, *add size*, *no price*).
- Sort/group so **not-ready drafts float above ready ones** (keep listed/review
  grouping intact). Optional small filter: All / Needs attention / Ready to fill.

**Accept:** at a glance the seller sees which drafts still need a human and jumps
straight to them; fully-correct drafts are visibly "Ready" without opening them.

## Part R2 — "Finish drafts" attention queue  (biggest lever)

**New:** `ui/src/components/FinishScreen.tsx`; reached from Home and the workspace
header (like Measure). Model it on `MeasureScreen.tsx` (one pass, debounced
autosave, same `saveItem` path).

- Iterate all drafts; for each, render **only the unresolved required fields**
  from `readiness(item)` — unconfirmed category (inline combined picker), low-
  confidence brand (title + verify), missing/unclear size, missing condition,
  missing price (with a Recompute action), and optionally missing measurements.
- Skip drafts that are fully **Ready** — they never appear. Inline controls,
  autosave, keyboard-tabbable top to bottom.
- Header shows progress (e.g. *"6 of 21 drafts still need attention"*).

**Accept:** a seller resolves every gap across the batch without opening a single
full editor; correct drafts require zero interaction.

## Part R3 — Keyboard-first draft navigation

**Files:** `ui/src/components/DraftEditor.tsx` / `Editor.tsx` / `App.tsx`
(wherever selection lives).

- Hotkeys in the workspace: **next / prev draft** (`J`/`K` and `↓`/`↑`),
  **save-and-next** (e.g. `Cmd/Ctrl+Enter`), and **fill** (a dedicated key, e.g.
  `F`, only when Chrome is `ready`). Ignore when focus is in a text input except
  for save-and-next.
- Show the shortcuts in a small "?" affordance or tooltip; don't hijack normal
  typing.

**Accept:** a confident seller moves through drafts and fires fills without
returning to the sidebar; typing in fields is never disrupted.

## Part R4 — Bulk edit across selected drafts

**Files:** `ui/src/components/Sidebar.tsx` (multi-select), a small bulk action bar.

- Allow multi-select of drafts in the sidebar (checkbox or shift/ctrl-click).
- A bulk action bar offers **safe** batch edits only: set **condition**, add/
  remove a **tag**, apply a **description style/profile**, assign an **album**.
  Each maps to the existing per-item `saveItem` edits, applied in a loop.
- Explicitly **exclude** size, measurements, and price *values* from bulk set
  (per-item truth). Bulk **Recompute price** is acceptable (re-runs each item's
  own comps) if low effort; otherwise skip.
- No bulk fill / no bulk submit.

**Accept:** setting condition or adding a tag across 15 drafts is one action, not
15; guarded fields are untouched.

## Part R5 — Batch fill tracker

**Files:** `ui/src/App.tsx` (+ small `FillTracker.tsx`), reusing the existing
`nextDraft` / fill-next state.

- A persistent, compact strip while working a batch: **"3 of 9 listed"** with the
  current draft and the next one queued, plus a jump-to-next control that reuses
  the existing single-click fill-next (still one manual click per item).
- Scope the count to the active album/batch if available; otherwise all drafts.
- Collapses when nothing is in flight.

**Accept:** the seller always sees batch progress and the next item, keeping
momentum across the app↔Chrome round-trips; it never fills without the manual
click.

## Verification

1. `npm run ui:typecheck` clean. (`ui:build` may fail off-macOS on the native
   rolldown binary — environmental.)
2. Mock preview (`ui:dev`): with a batch of drafts (some complete, some missing
   fields), confirm — R1 chips + sort; R2 shows only gaps and skips ready drafts;
   R3 hotkeys navigate/save/fill without disrupting typing; R4 bulk-sets a tag/
   condition across a selection and leaves size/measurements/price untouched; R5
   tracker counts listed/total and points to the next draft.
3. Confirm constraints: fill still one manual click per item, no submit, nothing
   guessed, driver/pipeline/selectors untouched.

## Sequencing note

If shipping incrementally, **R1 + R2 give the most time back** (stop opening
correct drafts) — do them first. R3–R5 are momentum/throughput multipliers on top.

## Not in scope here

Onboarding/first-run clarity and setup/distribution are covered separately in
`docs/PROMPT-friend-beta-readiness.md`; this doc is purely about listing a batch
faster.

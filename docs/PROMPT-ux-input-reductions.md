# Build prompt — UX input-reduction pass (audit §2, items 1–6)

Implement the six **in-scope** input-reduction opportunities from
`docs/UX-AUDIT-inputs.md` §2 ("In-scope, do-able"). These are all **UI-layer
only**. Read `CLAUDE.md` and `docs/UX-AUDIT-inputs.md` first.

## Hard constraints (do NOT violate — these bound every change below)

- The app **never** submits/publishes on Grailed. No change here may add a
  submit, and none may infer Chrome's state.
- The **category cascade stays gated**: it is only filled after the user
  explicitly confirms the category. A confident suggestion may auto-adopt (as
  today), but low-confidence items must still require an explicit **Confirm**
  action before `attributes.grailed_department/grailed_category` are set. Item 3
  changes the *picker widget*, not this gate.
- **One click per item still triggers a fill.** Item 1 only collapses a
  *duplicate* confirm inside the post-fill banner; it must not auto-fill or
  auto-advance anything new.
- Do **not** touch `ui/autofill-driver.js`, the pipeline, guarded IPC handlers,
  the grouping/pricing/confidence math, or `grailed-selectors.json`. If a change
  seems to need them, stop and flag it — it's out of scope.
- No new heavy dependencies. Use the existing shadcn/lucide/Tailwind primitives
  already in `ui/src/components/ui`.

## Scope: the six changes

### 1. Last-item single-click publish
**File:** `ui/src/components/DraftEditor.tsx` (the `fillOutcome` post-fill banner
block, ~lines 792–817).

Today, when `nextDraft` exists the banner shows a one-click **"I published —
fill next draft"** (`publishAndNext`, which marks listed with no confirm
dialog). When `nextDraft` is `null` (the last draft) the banner only offers the
dismiss button, forcing the user to the separate actions-card **Mark listed →
Yes** two-step confirm.

Add a one-click **"I published — mark this listed"** button in the banner for the
`nextDraft == null` case. It should call `markSubmitted()` directly (same
status-flip path, no `confirmSubmit` arm) — mirroring the one-click middle-item
path, which is justified because the user is in the same just-filled-and-
published context. Keep the standalone actions-card "Mark listed" (with its
confirm) unchanged for items reached *outside* this banner.

**Accept:** on the final draft, after a fill, the banner marks the item listed in
a single click; middle items unchanged; the standalone "Mark listed" confirm
still exists for the non-post-fill case.

### 2. "Measure all" reachable from the workspace
**Files:** `ui/src/App.tsx` (workspace header, the `else` branch with Home / Dock
Chrome / ThemeToggle), optionally `ui/src/components/Sidebar.tsx`.

Add a **Measure** button (lucide `Ruler`, matching Home's) to the workspace
header that calls `setView('measure')`. `draftQueue` is already computed in
`App`. Show it only when `draftQueue.length > 0` (same condition as Home).

Preserve context on exit: track the view Measure was launched from so
`MeasureScreen.onDone` returns to the **workspace** (keeping the current
`selected`) when launched from the workspace, and to **home** when launched from
Home. A small `measureReturn` state (`'home' | 'workspace'`) is enough.

**Accept:** from a draft in the workspace, Measure is one click away and Done
returns to the same draft; the Home entry point is unchanged.

### 3. Combined "Department › Category" picker in the confirm card
**File:** `ui/src/components/DraftEditor.tsx` (the low-confidence branch of the
`sec-category` card — the two `Select`s + Confirm, ~lines 662–703).

Replace the two separate Department and Category `Select`s with **one** control
whose options are the valid `Department › Category` pairs flattened from
`fillOptions.categoryTree` (e.g. label `"Menswear › Tops"`, value encodes both).
Selecting a pair sets `pendingDept` + `pendingCat` together. **Keep the explicit
`Confirm for autofill` button** — the staged gate is unchanged. Seed the control
from `suggestion` when present.

A flattened `Select` is the minimum; a searchable combobox
(Command + Popover) is a nice-to-have only if it stays dependency-free. Preserve
the existing re-seed-on-item-switch behavior.

**Accept:** low-confidence items confirm in two interactions (pick pair →
Confirm) instead of three; auto-adopted items still show the "✓ selected" state
with **Change**; the `ui/main.js` gate is untouched.

### 4. "New batch" opens the OS folder picker directly
**Files:** `ui/src/components/ImportScreen.tsx`, `ui/src/App.tsx` (`newBatch`).

Skip the intermediate drop-zone click: when the user chooses **New batch**, open
the OS folder picker on entry. Implement with a one-shot `autoPick` prop passed
to `ImportScreen`, set by `App.newBatch()` and consumed once on mount — only fire
`onClick()` when not `running` and no `result` is showing. Do **not** auto-fire
when the user merely navigates to Import to check progress or view a summary. On
cancel, fall back to the normal Import screen.

**Accept:** New batch → folder dialog with no extra click; visiting Import while a
batch runs or a summary is shown does not pop the dialog.

### 5. Persist Dock-Chrome preference
**File:** `ui/src/App.tsx` (`docked` state / `toggleDock`).

Persist the user's dock *intent* (localStorage is fine — this is the Electron
renderer, a real browser context; the no-localStorage rule is for Claude.ai
artifacts, not this app). On entering the workspace with intent = true and not
currently docked, attempt `startDock()` **once** and **swallow failure quietly**
(no toast) — Chrome may not be launched yet. Toggling off clears the intent.

**Accept:** re-opening the app with dock previously on re-docks silently when
Chrome is up, and does nothing noisy when it isn't.

### 6. Auto-focus the first empty required field  *(the priority one)*
**Files:** `ui/src/components/DraftEditor.tsx`, optionally
`ui/src/components/ListingChecklist.tsx`.

On opening a draft (keyed on `item.id`), move focus to the first **empty
required** field so keyboard users don't mouse to it. Check in checklist order,
skipping non-focusable rows: **Title** (input) → **Description** (textarea) →
**Size** (input) → **Price** (input). Focus the first one that's empty; if all
are filled, do nothing (never steal focus from a complete draft). Use a ref +
`useEffect` on `item.id`.

Optionally, make a `ListingChecklist` row click focus the target field after the
existing `scrollIntoView`, not just scroll.

**Accept:** opening a draft with an empty title lands the cursor in the title; a
fully-filled draft opens with no forced focus; checklist jumps still scroll.

## Verification (required before declaring done)

1. `npm run ui:typecheck` and `npm run ui:build` clean.
2. Mock-preview walkthrough (`npm run ui:dev`, no Electron/keys needed):
   - Item 1: last draft post-fill banner marks listed in one click; a middle
     draft still shows "fill next".
   - Item 2: Measure button in the workspace header; Done returns to the same
     draft.
   - Item 3: category card shows one Dept › Cat picker + Confirm; confirm sets
     the cascade fields; Change reverts to the picker.
   - Item 4: New batch pops the folder dialog immediately; checking a running
     import does not.
   - Item 6: cursor lands in the first empty required field on open.
3. Item 5 needs the launched Chrome to fully verify docking; confirm the
   persisted intent is read on load and that a failed silent re-dock produces no
   toast.
4. Confirm none of the hard constraints above were touched (no submit path, gate
   intact, driver/pipeline/selectors untouched).

## Notes

- These are intentionally small; keep diffs tight and localized.
- Do **not** implement the deliberate-friction items in §4 of the audit, and do
  **not** implement the driver/pipeline recommendations (Chrome precondition
  detection, auto-navigate before fill, auto-recompute confidence) — those are
  owner decisions, not part of this pass.

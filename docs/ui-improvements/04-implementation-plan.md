# 04 — Implementation Plan (plan only; no code written yet)

Covers all **recommend** and **recommend-with-conditions** proposals from `02-proposals.md`, in dependency order. Per the repo's Working Agreements (CLAUDE.md): one branch + commit per step, diff review before merge, and "done = behavior verified by hand + tests green". Verification commands per step: `npm run ui:typecheck` always; `npm test` where libs change; manual checks listed per step. Rollback for every step is `git revert` of its single commit unless noted.

Effort key: S ≤ ~1h · M ~half-day · L ~1-2 days.

---

## Stage 0 — Safety net (enables everything after)

### Step 0.1 — UI test harness (S-2) — **M**
- **Files:** new `ui/vitest.config.ts`, `ui/src/lib/*.test.ts`, `ui/src/test/setup.ts`; `package.json` (devDeps: vitest, @testing-library/react, jsdom; script `ui:test`).
- **Content:** unit tests for `lib/readiness.ts`, `lib/quality.ts`, `lib/shortcuts.ts`, `lib/utils.ts` (pure, high value); one mock-mode render-App smoke test.
- **Acceptance:** `npm run ui:test` green in CI alongside the offline suite; smoke test mounts Home without crashing.
- **Verify nothing broke:** no production code touched.
- **PR boundary:** standalone. **Rollback:** revert; deletes only test files.

## Stage 1 — Quick wins (independent; can land in any order after 0.1)

### Step 1.1 — QW-1 shared `money()` — **S**
- **Files:** `lib/utils.ts` (+`money` +test), `Home.tsx`, `TriageBoard.tsx`, `DraftEditor.tsx`, `PricePanel.tsx` (remove locals, import).
- **Acceptance:** prices render with separators ("$1,200") everywhere; matches `mockups/visual-polish.html` right panels.
- **Verify:** ui:test (new money test), typecheck; smoke-check Home board, list rows, DraftEditor price echo, PricePanel.
### Step 1.2 — QW-2 delete dead primitives — **S**
- **Files:** delete `ui/card.tsx`, `ui/separator.tsx`; `package.json` (drop `@radix-ui/react-separator`), lockfile.
- **Acceptance:** `ui:build` + typecheck green (proof of zero imports per Manifest R1/R2).
- **Verify:** full app smoke (any screen — import graph is static).
### Step 1.3 — QW-6 + QW-7 renames/shared status map — **S**
- **Files:** `DraftEditor.tsx` (rename const), new `lib/statusLabels.ts`, `Sidebar.tsx`, `CommandPalette.tsx`. **Do not touch** `FillChangesCard`'s `STATUS_WORD` (Manifest R6).
- **Acceptance:** sidebar badges + palette status words unchanged on screen.
### Step 1.4 — QW-4 TagEditor dedupe — **S**
- **Files:** `TagEditor.tsx` only; keep `key={tag+i}` (Manifest U1).
- **Acceptance:** adding an existing tag (any case) is a no-op; bulk-bar behavior unchanged.
- **Verify:** manual: add dup tag in DraftEditor; ui:test optional component test.
### Step 1.5 — QW-5 shared import-progress weighting — **S/M**
- **Files:** new `lib/importProgress.ts` (+test), `ImportScreen.tsx`, `BatchProgressBar.tsx`.
- **Condition from Manifest U7:** each bar keeps its current `analyzing` rendering; only the numeric mapping is shared (drift fixed: grouping/preparing values become identical).
- **Acceptance:** run a mock import; the thin strip and the Import screen bar show the same percent at each stage.
- **Verify:** unit test the mapping table; manual import in `ui:dev` mock mode.
### Step 1.6 — QW-3 toast stack — **M**
- **Files:** `App.tsx` (state + render), possibly new `components/ToastStack.tsx`. The 15 consumers are untouched (signature kept, Manifest R4).
- **Acceptance:** matches `mockups/toast-notifications.html`: two rapid toasts stack; ✕ dismisses; container `aria-live="polite"`; long messages keep the length-scaled duration.
- **Verify:** ui:test for queue logic (add/expire/cap 3); manual: trigger fill toast + album-toggle failure together in mock mode.
- **Test note:** this is the step most likely to need new tests updated later — the smoke test asserts on toast presence if extended.

## Stage 2 — Shared components (each independent; 2.x after Stage 1 merges to avoid rebases)

### Step 2.1 — M-2 `CoverThumb` — **M**
- **Files:** new `components/CoverThumb.tsx`; edit `Home.tsx`, `Sidebar.tsx`, `TriageBoard.tsx`, `ConfirmScreen.tsx`, `ConfirmCard.tsx`, `CommandPalette.tsx`. **Exclusions:** `PhotoRow`'s `PhotoTile` and `lib/api.ts:576` data value (Manifest R9, U5 — U5 decision needed from you, see Blocked list).
- **Acceptance:** all 6 sites pixel-equivalent in dark mode; light mode shows `bg-muted` fallback (mockup `visual-polish.html`); photo-count badges still overlay (children prop).
- **Verify:** smoke every screen in both themes; typecheck.
- **PR boundary:** one PR; 6 small mechanical call-site diffs.
### Step 2.2 — M-6 `TwoStepDelete` + `SaveChip` — **M**
- **Files:** new `components/TwoStepDelete.tsx`, `components/SaveChip.tsx`; edit `Home.tsx`, `TriageBoard.tsx`, `DraftEditor.tsx`, `ConfirmScreen.tsx`.
- **Acceptance:** arm → "Sure?" → delete flow identical in list rows and card overlay (incl. `stopPropagation`, 3.5s disarm, aria-labels); save chip identical in both hosts.
- **Verify:** manual delete in both Home views + board; edit-save in editor and confirm pass; ui:test for the arm/disarm timer.
### Step 2.3 — M-7 `CategorySelect` (grouped) — **M**
- **Files:** `ui/select.tsx` (+`SelectLabel` re-export), new `components/CategorySelect.tsx`; edit `DraftEditor.tsx`, `ConfirmCard.tsx`.
- **Hard constraint (Manifest R11):** the staged Confirm gate and `grailed_department/category` writes stay in the callers; `"Dept||Cat"` key kept.
- **Acceptance:** matches `mockups/category-picker-grouped.html`; confirming still sets both fields only on Confirm; fill payload unchanged (inspect `editsOf` output before/after in mock).
- **Verify:** manual: suggest → confirm → change → clear cycle in editor AND confirm pass; typecheck.
### Step 2.4 — M-5 error boundaries — **M**
- **Files:** new `components/ErrorBoundary.tsx`; `App.tsx` (root wrap + Editor-pane wrap).
- **Acceptance:** matches `mockups/error-boundary-fallback.html`; a thrown render error in DraftEditor (temporary dev throw) shows fallback with real message, Copy works, "Reload this screen" remounts, header still navigates; dev console still logs the error.
- **Verify:** manual induced-error test in `ui:dev`; remove the induced throw before merge.
- **Rollback:** revert — boundary is additive.

## Stage 3 — Modal & typography (sequenced within stage)

### Step 3.1 — M-1 shared Modal (includes QW-8) — **L**
- **Files:** `package.json` (+`@radix-ui/react-dialog`), new `components/ui/dialog.tsx` + `components/Modal.tsx`; migrate **one modal per commit** in order: DefaultsMenu → GuideMenu → Onboarding → StyleEditor → CommandPalette → (optional) Updater.
- **Hard constraints (Manifest R8 table + U6):** preserve each modal's current backdrop/Escape behavior via props; StyleEditor blocks Escape/backdrop when `dirty`; Updater stays un-closeable while `applying`; CommandPalette keeps its own key handling priority; Radix Select portals inside StyleEditor/DefaultsMenu must remain operable.
- **Scrim standardization to /50** rides along (visible but trivial).
- **Acceptance per commit:** dialog role/aria-modal present (inspect a11y tree), focus trapped and restored on close, prior close affordances unchanged (per R8 table), Selects inside still open/choose.
- **Verify:** keyboard-only walkthrough of each migrated modal; smoke test extended to open/close each.
- **Rollback:** per-commit revert — each modal migration is independent.
- **Blocked sub-item:** enabling *new* backdrop-close/Escape on GuideMenu/Onboarding waits on your U6 decision; the migration itself does not.
### Step 3.2 — M-3 typography tokens (1:1 codemod) — **M**
- **Files:** `tailwind.config.cjs` (fontSize tokens), ~30 component files (mechanical), CI grep (`.github` workflow or `test-all` addition) banning `text-\[\d+px\]`.
- **Acceptance:** zero visual change (spot-diff screenshots of Home, workspace, confirm pass at 100% zoom); grep gate red on reintroduction.
- **Verify:** typecheck + visual spot-diff; land as one commit, review with `--word-diff`.
- **Depends on:** nothing, but must land **before** 3.3 and **after** 2.x to avoid rebase pain.
### Step 3.3 — M-4 contrast pass — **S/M** — **OWNER SIGN-OFF GATE**
- **Files:** the 9-10px/`/60`/`/70` sites (Manifest R12 inventory).
- **Acceptance:** matches `mockups/micro-text-contrast.html`; no text below 11px; no opacity-diluted muted text; owner approves screenshots before merge (this deliberately edits the hand-tuned theme).
- **Verify:** contrast-check the changed pairs (target ≥4.5:1); both themes.
### Step 3.4 — M-8 accessible tooltip equivalents (phase 1 of 2) — **S**
- **Files:** `DraftEditor.tsx` (Fill button `aria-describedby` → visually-hidden text), `PricePanel.tsx` (confidence pill same).
- **Acceptance:** SR announces the fill explanation and confidence detail on focus; zero visual change.
- **Phase 2 (visible text for sidebar blocker detail + quality score)** is **blocked on owner sign-off** — it adds visible text to deliberately quiet surfaces.

## Stage 4 — Structural (last; highest risk)

### Step 4.1 — S-1 DraftEditor split — **L** — 3 sequential PRs
1. **PR-a:** extract `useFillOrchestration` hook (state + effects + `startFill`/`fillListing`/`recheckChrome`/`publishAndNext`/`duplicateItem`). Move `editsOf` to `lib/edits.ts` and update the two imports (`App.tsx:12`, DraftEditor) in the same commit (Manifest R13).
2. **PR-b:** extract `FillActionsCard` (rail action section, lines ~1059-1200) + it consumes the hook's returns via props.
3. **PR-c:** extract `DraftForm` (left column); `DraftEditor` becomes composition + save logic.
- **Acceptance per PR:** zero visual change; the full manual fill matrix passes: normal fill · blocked card (not connected / not logged in / no sell tab) · Recheck · Fill anyway · first-fill prompt (clear localStorage) · changed-only fill · "Fill everything again" · F key · palette Fill · FillTracker "Fill next draft" · publish-and-next · last-item mark-listed. New hook unit tests (gate logic: probe→blocked→force; autoFill consume-once; fillSignal skip-mount).
- **Verify:** ui:test + the manual matrix per PR (CLAUDE.md's verified-by-hand bar).
- **Rollback:** revert the specific PR; they're sequential but individually revertible in reverse order.
### Step 4.2 — S-3 photo-rail sidebar — **M/L** — **BLOCKED on owner answer**
- **Precondition (from 02):** confirm you actually use Dock Chrome regularly; skip entirely if not.
- **Files:** `App.tsx` (workspace grid: `320px` → responsive `320px | 116px`; header gains a PanelLeft ghost-Button toggle next to "← Home"), `Sidebar.tsx` (photo-rail variant: ~96×120px 4:5 tiles reusing `CoverThumb` from Step 2.1, blocker/"ready" chip over the photo on the existing `bg-black/55` scrim, brass selection ring, full title as tooltip), new persisted key `tailor.sidebarMode` (`auto` / `expanded` / `compact`).
- **Toggle semantics:** default `auto` (collapse below ~1100px, restore above); clicking the header toggle sets an explicit mode that overrides the breakpoint and persists; the icon reflects current state (`PanelLeftClose`/`PanelLeftOpen` from lucide, `aria-label` + `title`, matching the header's existing ghost-Button pattern).
- **Acceptance:** matches `mockups/compact-sidebar-docked.html` (large photos remain the primary draft identifier — owner requirement 2026-07-18); toggle works at any width and survives restart; auto mode collapses below ~1100px, restores above; every draft reachable in one click from the rail; readiness chip legible over busy photos in both themes; J/K, selection accent, and bulk select (via expand) all work.
- **Verify:** manual at 900px with Dock active; both themes; smoke test at narrow viewport.
- **Depends on:** Step 2.1 (`CoverThumb`).

---

## Blocked pending your confirmation (restated from Manifest — NOT in the plan as deletions/changes)

| Manifest # | Item | Plan handling |
|---|---|---|
| U1 | Stored duplicate tags → `key={tag+i}` stays | Step 1.4 keeps index keys |
| U2 | `descProfile` type field | Untouched; optional `@deprecated` comment only |
| U3 | Unused shadcn exports (`SelectGroup` etc.) | Kept (M-7 starts using `SelectGroup`) |
| U4 | ScrollArea `!important` patch | Kept; note added near dep (S-5 rejected) |
| U5 | `lib/api.ts:576` `tint '#333'` data value | Kept; decide during Step 2.1 review |
| U6 | New close affordances on GuideMenu/Onboarding | Modal preserves current behavior; enabling waits on you |
| U7 | Thin-bar `analyzing` rendering | Each bar keeps current rendering |
| — | M-4 contrast pass & M-8 phase 2 visible text | Gated on your screenshot sign-off (Steps 3.3, 3.4) |

## Sequencing summary

```
0.1 tests ─┬─ 1.1 … 1.6 (any order) ─┬─ 2.1 CoverThumb
           │                          ├─ 2.2 TwoStepDelete/SaveChip
           │                          ├─ 2.3 CategorySelect
           │                          └─ 2.4 ErrorBoundary
           └────────────────────────────► 3.1 Modal → 3.2 type tokens → 3.3 contrast* → 3.4 tooltips
                                             └──────────────────────────► 4.1 DraftEditor split → 4.2 sidebar*
* = owner-gated
```

## Total estimated effort

Quick wins ~1.5 days · shared components ~2 days · modal/typography ~2.5 days · structural ~2-3 days (+0.5 optional sidebar). **≈ 8-9 working days** end-to-end, but the stages are independently shippable — Stage 0+1 alone (~2 days) captures the toast, dead-code, price-format, and drift fixes.

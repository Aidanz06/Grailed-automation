# UX Audit — Input & Clarity Review (Tailor Studio)

Date: 2026-07-06
Scope: reduce clicks / keystrokes / screen-hops across the folder→listed
workflow, and make the process legible to a first-time user. **Analysis only —
no code changed.** The AI pipeline, the CDP autofill driver, the grouping/
pricing/confidence math, the `ui/main.js` IPC layer, and the staged category
gate are read-only reference here. Anything that would touch them is marked
**OUT OF SCOPE (recommend, don't do)**.

Files read for this audit: `App.tsx`, `Home.tsx`, `ImportScreen.tsx`,
`ReviewScreen.tsx`, `DraftEditor.tsx`, `Editor.tsx`, `MeasureScreen.tsx`,
`PricePanel.tsx`, `ListingChecklist.tsx`, `FillProgressCard.tsx`, `Sidebar.tsx`,
`PhotoRow.tsx`, `DetailPanel.tsx`, `lib/api.ts`, `lib/measurements.ts`,
`lib/grailedCategory.ts`; plus `CLAUDE.md`, `docs/REMAINING-WORK.md` (§B, §D2),
`docs/UX-REVIEW-listing-workflow.md`.

Headline: the app has already been optimized hard (auto-adopted category/color,
one-click fill-next chaining, batch Measure, streamed drafts, an auto-save
everywhere). Steady-state **per-item app cost is already ~1 click**. The
remaining wins are (a) a handful of clean single-click removals, (b) closing
navigation round-trips, and (c) one genuinely dangerous *clarity* gap — the
auto-fill-next fires into Chrome with no check that Chrome is on a fresh Sell
form — that is worth more than any click count.

---

## 1. Click / input map of the current happy path

Assumptions for the worked example: **one batch, 9 photo-groups**; the AI is
accurate enough that most fields are accepted as-is; **2 of 9 groups flagged**
for review; **3 of 9** need a manual category confirm (the other 6 auto-adopt a
confident suggestion); measurements are entered once in batch Measure mode. A
real, separately-launched Chrome is logged in on `grailed.com/sell/new`.

Legend: **[act]** = user click/keystroke in the app · **(wait)** = user waits
on a machine step · **{Chrome}** = manual action in the real Chrome window
(deliberate, outside the app).

### Per-batch, end to end

| # | Stage | User actions | App clicks | Notes / waits |
|---|-------|--------------|-----------:|---------------|
| 0 | Home → start | **[New batch]** | 1 | goes to workspace/Import |
| 1 | Import | **[click folder drop-zone]** → **[pick folder + Open]** in OS dialog | 2 | then **(wait)** full pipeline: group → attributes → price → content; drafts stream in |
| 2 | Enter editing | **[Start with the first draft]** on the summary | 1 | summary persists; could also click a streamed "Start editing" card mid-run |
| 3 | Review (×2 flagged) | per group: **[select in sidebar]** → **[These photos are one item]** | 4 | each confirm **(wait ~1 min)** re-runs the pipeline; happy path = "confirm as one item" |
| 4 | Category confirm (×3 low-confidence) | per item: **[Department]** → **[Category]** → **[Confirm for autofill]** | 9 | the other 6 items auto-adopt — **0 clicks** |
| 5 | Field review (×9) | scan title/desc/condition/color/price; accept | 0 | happy path only; each correction is extra |
| 6 | Measure (batch) | **[Home]** → **[Measure]** → tab through all drafts → **[Done]** | 3 + typing | ~9 items × ~3 fields ≈ **27 field entries**; debounced autosave |
| 7 | Dock Chrome (once) | **[Dock Chrome]** | 1 | optional; not persisted across sessions |
| 8 | Fill — item 1 | **[Fill listing in Chrome]** → **(wait ~20s)** → {review} → {Publish} → **[I published — fill next]** | 2 | + 1 manual Chrome navigate to a fresh Sell form |
| 9 | Fill — items 2–8 | fill **auto-starts on mount** → **(wait)** → {review} → {Publish} → **[I published — fill next]** | 7 | 1 click each (the publish-next of the prior item) |
| 10 | Fill — item 9 (last) | fill auto-starts → {review} → {Publish} → **[Mark listed]** → **[Yes — it's live]** | 2 | no "next draft" ⇒ falls back to the 2-step confirm |

**Per-batch app-click total ≈ 30** (0:1, 1:2, 2:1, 3:4, 4:9, 6:3, 7:1, 8:2,
9:7, 10:2), **plus ~27 measurement field entries**, **plus 9× manual Chrome
sequences** (navigate to Sell form → review → Publish), plus the import wait and
2× review waits.

**Per-item marginal cost (steady state, middle item, AI accurate): ~1 app
click** (the publish-next button), + 1 {Chrome navigate} + {review} + {Publish}.
This is already very lean — the design has pushed the app side down to a single
click per item.

### Where the user *waits* vs *acts*

- **Waits (no action possible):** the import pipeline (longest), each review
  re-process (~1 min each), each fill (~20s). Import and fill now stream
  progress; review confirm shows only a start toast + spinner.
- **Acts continuously:** category confirms, field corrections, and Measure
  typing — the real keystroke sinks.

### Where the user must remember something with no prompt

1. **Open a fresh `grailed.com/sell/new` in Chrome before every fill.** The
   fill (and especially the *auto*-fill-next) writes into whatever page Chrome
   currently shows. After publishing item N, Chrome is still on item N's page;
   when item N+1's editor mounts it **immediately fires a fill** — into the
   wrong/stale page — unless the human has already navigated Chrome to a new
   Sell form. Nothing in the app says so. **This is the highest-severity gap in
   the whole flow** (see §3.1).
2. **Measure mode exists.** Only surfaced as a Home-header button that appears
   only when drafts exist. A first-timer editing drafts in the workspace never
   sees it.
3. **Recompute to get a price-confidence badge on older items.** Stored-range
   items render no confidence badge until a Recompute; nothing hints at it.
4. **Chrome must be launched + logged in** for Fill/Dock to do anything. The
   only hint is a helper line citing `npm run 0b:launch` — a dev command.

---

## 2. Input-reduction opportunities (ranked by clicks saved × low risk)

Ranking favors changes that are **in-scope (UI flow / defaults / navigation /
confirmation batching)** and **low-risk**. Big-ticket items that would touch the
driver/CDP/pipeline are listed at the bottom as **recommend-only**.

### In-scope, do-able

| Rank | Change | Saves / batch | UI files | Risk | Scope |
|------|--------|--------------:|----------|------|-------|
| 1 | **Last-item single-click publish.** On the final draft the not-saved banner has no "fill next", so the user drops to the 2-step **Mark listed → Yes**. In that banner the user *just* filled+published in context, exactly like middle items which mark-listed in **one** click. Show "I published — mark this listed" as a single button on the last item too. | 1 click | `DraftEditor.tsx` (banner branch when `nextDraft == null`) | Low — same post-fill context that already justifies the one-click path for middle items | In scope (confirmation batching) |
| 2 | **"Measure all" reachable from the workspace.** Add the Measure entry to the workspace header or sidebar so the user doesn't hop **Home → Measure → back** mid-edit. | 2 nav clicks per measuring session | `App.tsx` header, `Sidebar.tsx` | Low | In scope (navigation) |
| 3 | **Combined "Department › Category" picker in the confirm card.** Low-confidence items cost 3 interactions (2 selects + Confirm). A single searchable combobox of valid `Dept › Cat` leaves seeded from the suggestion + one Confirm = 2 interactions. Gate logic in `ui/main.js` is untouched (still only fills what's confirmed here). | 1 interaction × low-confidence items (~3) | `DraftEditor.tsx` category card | Low–Med (new picker UI only) | In scope (picker UI, not cascade fill) |
| 4 | **"New batch" opens the OS folder picker directly.** Today: New batch → Import screen → click drop-zone → OS dialog. If no batch is running, fire `pickBatchFolder()` on entry (Import screen still renders behind it and on cancel). | 1 click | `ImportScreen.tsx`, `App.tsx` (`newBatch`) | Low | In scope (flow) |
| 5 | **Persist Dock-Chrome preference** across sessions so returning users don't re-click it each launch. | 1 click (occasional) | `App.tsx` (persist `docked` intent) | Low | In scope (defaults) |
| 6 | **Auto-focus the first empty required field** on opening a draft (or the first checklist "todo" on click-through), so keyboard users don't mouse to it. | keystroke/mouse friction | `DraftEditor.tsx`, `ListingChecklist.tsx` | Low | In scope |

Net in-scope savings on the worked batch: roughly **4–6 app clicks + 2
navigation hops**, on top of the already-lean baseline — plus the ergonomic wins
(combined picker, autofocus).

### Recommend-only (OUT OF SCOPE — would touch guarded functionality)

| Item | Why valuable | Why out of scope |
|------|--------------|------------------|
| **Auto-navigate Chrome to a fresh `/sell/new` before each fill** (or gate the auto-fill-next until the driver confirms Chrome is on an empty Sell form). | Eliminates the #1 hazard in §1/§3.1 and would make the fill-next chain safe to trust. | Requires the CDP driver to read Chrome's URL / navigate — driver + `ui/main.js`. Navigation is arguably not "submitting," but it changes Chrome state, so treat as owner decision. **Recommend, don't do.** |
| **Chrome precondition chip** (connected / logged-in / on Sell form) in the workspace header. | Turns the invisible Fill/Dock preconditions (§3.2) into a glanceable status. | Detection needs the driver to probe Chrome — out of the UI layer. The *wording* half of this fix is in-scope (see §3.2). |
| **Auto-recompute price confidence on open for legacy items** (cache-served). | Removes a manual Recompute click to see the badge. | Calls the guarded comp provider path; even cache-served this is pricing-layer. Recommend as a pipeline decision. |
| **"Fill all drafts" / autonomous chaining.** | Would remove the per-item click entirely. | **Violates a hard constraint** — each fill must be a manual per-item trigger. **Do not build.** |

---

## 3. UI-clarity review (first-time-user legibility)

### 3.1 The auto-fill-next / fresh-Sell-form gap  — highest priority

**Symptom.** "I published — fill next draft" marks the current item listed, jumps
to the next draft, and that editor **auto-fires `fillListing` on mount**
(`DraftEditor` `autoFill` effect). But the app never checks — and never reminds
the user — that Chrome has been moved to a *new, empty* `grailed.com/sell/new`.
After publishing item N, Chrome is still on item N's published page. The fill
can pour item N+1's fields into the wrong page, silently.

**Why it reads fine to the builder but not the user.** The one-click chain is a
genuinely nice affordance; the missing precondition is invisible because the app
can't see Chrome.

**In-scope fixes (wording/affordance only — no driver work):**

- Replace the silent auto-fire with an **armed** state on the next draft: the
  fill button glows and reads **"Chrome ready on a new Sell form? — Fill this
  draft"**, pre-focused, requiring the same single click. This keeps the
  one-click-per-item constraint *and* removes the hazard. (Net click count
  unchanged; correctness up.)
- If auto-fire is kept, have `FillProgressCard` lead — before the plan rows —
  with a persistent line: **"Filling into whatever Chrome is showing. Make sure
  it's a fresh Sell form (`grailed.com/sell/new`)."**
- Reword the publish-next button to set the expectation: **"I published — take
  me to the next draft"** (advance) and keep *fill* as the explicit click on the
  next screen. This decouples "advance" from "fire into Chrome."

Recommend the driver-side guard (§2 recommend-only) as the real fix; the wording
change is the safe interim.

### 3.2 Chrome preconditions are invisible / dev-flavored

Fill and Dock silently assume a launched, logged-in Chrome on the Sell form. The
only hint is `DraftEditor`'s helper line and the Dock tooltip, both of which cite
**`npm run 0b:launch`** — meaningless to a non-developer.

- **In scope:** reword to human steps — *"Open the Tailor-launched Chrome and
  sign in to Grailed's Sell page. Fill types into that window; it never
  submits."* Drop the `npm` command from user-facing copy (keep it in docs).
- **Recommend (out of scope):** the precondition chip in §2.

### 3.3 Measure mode is under-discovered

`MeasureScreen` is the app's biggest keystroke saver but only reachable via a
Home-header button that renders **only when drafts exist**, and never appears in
the workspace where the user is actually editing.

- Add a Measure entry in the workspace (ties into §2 rank 2).
- On the **import summary**, add: *"9 drafts ready — measure them all in one pass
  (Measure)."*
- The inline hint in the Description/Measurements section ("Tab through all
  drafts at once from Home → Measure") is good but only shows when the
  measurements section is toggled on — surface it regardless.

### 3.4 Recompute & Regenerate — when and why

- **Recompute** (PricePanel) has an icon and a spinner but no "when would I use
  this?" Legacy items also show **no confidence badge until Recompute**, with no
  cue. Add subtext to the price card when `range.confidence` is absent:
  *"Recompute to estimate a confidence range from sold comps."*
- **Regenerate** already has a good legacy-item note in the Description section;
  keep it. Consider one tooltip on the Title-row Regenerate: *"Rewrites title +
  description from the current item details."*

### 3.5 Copy listing vs Fill listing — relationship unexplained

Two export paths sit side by side with no stated relationship (also flagged in
the prior UX review). Add subtext/tooltip: **Fill listing** = types into the
launched Chrome automatically; **Copy listing** = plain-text fallback to paste
in yourself. Frame Copy as the manual backup, not a parallel primary action.

### 3.6 Category card — mostly good, one gap

The card is well-labeled in both states (auto-adopted "✓ selected — will
autofill" with **Change**; low-confidence "suggestion — not filled until you
confirm" with the cascade explanation). The one thing a first-timer won't grasp
is **why this field alone is gated** while color/condition auto-fill. The card
does say "a wrong category cascades into wrong sizes" — promote that reason to
the label line so it's read before the pickers, e.g. **"Confirm the Grailed
category — it drives size, sub-category & designer, so we never guess it."**

### 3.7 Smaller clarity notes

- **Import summary "Start with the first draft"** is clear; keep it (the auto-
  jump was deliberately removed — see §4).
- **Review screen** copy is strong and self-explaining; no change.
- **Sidebar** status vocab ("listed") now matches Home — good.
- **Circuit-breaker banner** copy is developer-flavored ("remove
  `data/CIRCUIT_OPEN`"). For a personal-use v1 that's acceptable; reword only if
  distributed.

---

## 4. Deliberate friction — do NOT "optimize" away

These look like extra clicks/steps but are intentional. Listing them so a future
pass doesn't remove them:

1. **Publish always happens manually in Chrome.** The app never submits; every
   fill ends with the user reviewing and clicking Publish in Chrome. Non-
   negotiable.
2. **One click per item to trigger a fill.** The "Fill listing" button and the
   "I published — fill next draft" button *are* that manual trigger. No
   autonomous chaining beyond one click per item. (This is why "Fill all" in §2
   is do-not-build.)
3. **Category confirmation for low-confidence suggestions.** The cascade is only
   filled after the user confirms the category; confident suggestions auto-adopt
   but stay changeable. Never blind-fill.
4. **"Mark listed" confirm dialog** ("Did you actually publish on Grailed?") for
   items marked outside the post-fill banner — the app can't see Grailed, so it
   must ask. (§2 rank 1 only removes the *duplicate* confirm on the last item
   *inside* the post-fill banner, where publish was just asserted in context —
   it does not touch this standalone confirm.)
5. **Two-step permanent Delete** ("Sure?"). Keep.
6. **No auto-jump to a draft when a background import finishes.** Deliberately
   removed so a background batch can't yank the user off what they're doing; the
   summary + "Start editing" card replace it. Keep.
7. **Auto-adopt category/color only when it validates against
   `grailed-selectors.json`;** manual picker otherwise. Keep.
8. **Login / captcha are manual in the real Chrome; no fingerprint/UA spoofing;
   DOM selectors stay in `grailed-selectors.json`.** Untouchable.

---

## Appendix — quick-win shortlist (highest value, lowest risk first)

1. **§3.1 fresh-Sell-form wording / armed fill** — prevents silent mis-fills
   (correctness, not clicks; do this first).
2. **§2.1 last-item single-click publish** — −1 click/batch, trivial.
3. **§2.2 Measure from the workspace** + **§3.3 discoverability** — −2 hops,
   surfaces the biggest keystroke saver.
4. **§3.2 / §3.5 / §3.4 wording fixes** — de-jargon Chrome/Copy/Recompute copy.
5. **§2.3 combined category picker** + **§2.4 direct folder picker** — shave the
   remaining per-item and per-batch clicks.

Everything above stays inside UI flow, defaults, navigation, and confirmation
batching. The three highest-leverage *structural* wins (Chrome precondition
detection, auto-navigate before fill, auto-recompute confidence) all require
driver/pipeline changes and are left as **owner recommendations**, not edits.

# UX Review — Tailor Studio listing workflow

Date: 2026-07-05 · Analysis only (no code changed). Reviewed against `CLAUDE.md`,
`docs/REMAINING-WORK.md`, `docs/grailed-automation-prd.md` (§4/§5/§8), and
`docs/PLANS-v1-vs-extension.md`. Walkthrough is reconstructed from the renderer
components and `ui/src/mock/items.ts` (what `npm run ui:dev` actually renders);
`ui:typecheck` passes clean, so the code read here is the live build. The native
Electron window can't be screenshotted from this environment, so observations are
code-grounded rather than pixel-grounded — flagged where that matters.

**Scope caveat on in-flight files.** `DraftEditor.tsx`, `autofill-driver.js`,
`api.ts`, `main.js`, and `grailed-selectors.json` are being actively changed by the
A1 (category/size/designer) session. Every recommendation that touches them notes
the assumption it rests on. Where A1 is mid-build, I describe the *seam* to design
against, not a specific diff.

**Portability lens.** Per `PLANS-v1-vs-extension.md`, v1 finishes on Electron, then
the shell swaps to a Chrome extension Side Panel + local companion. The React UI,
the pipeline, the fill expressions, and the selectors all carry across; only the
window-docking glue and the CDP *connection* are discarded. Recommendations are
tagged **Ports** (survives the swap) or **Electron-only** (throwaway) so you don't
invest polish in code Plan B deletes.

---

## 1. Workflow walkthrough — how it actually presents, with friction

### Step 0 — Home (`Home.tsx`)
Three stacked sections: **Needs your attention**, **Drafts waiting to post (N)**,
**Currently listed on Grailed (N)**. Header carries the subtitle "mock data ·
pipeline & autofill not wired", a **Check Grailed messages** button, and **+ New
batch**. An app-wide circuit-breaker banner (`App.tsx`) sits above everything when
open.

Friction:
- **"Check Grailed messages" is a dead stub** wired to a `console.log` + toast
  ("stub, deferred per §8.5"). It sits in the primary header at equal weight to the
  real "+ New batch" action. A prominent button that does nothing trains the user to
  distrust buttons — the exact opposite of what a trust-critical tool wants.
- **Dev scaffolding is user-visible.** The "hide flagged (demo empty state)" toggle
  and the "mock data · UI shell" subtitles are shipping in the rendered UI. Harmless
  in mock preview, but they're in `Home.tsx`/`App.tsx` proper, not behind a dev flag.
- **Attention rows are informative but not resolvable from Home** — clicking routes
  into the workspace, which is correct, but see Step 4 for where that dead-ends.

### Step 1 — New batch → import (`ImportScreen.tsx`)
"+ New batch" switches to the workspace with `selection='import'`, showing a single
large dashed **Choose a photo folder** button. Click → native folder picker →
`processBatch(folder)`.

Friction:
- **One blocking call, zero progress.** The whole cluster+price pipeline runs behind
  a single `await` with a static toast ("This can take a minute…"). The button flips
  to "Processing photos…⏳" but there's no per-group, per-photo, or per-stage signal.
  For a batch shoot this is the longest opaque wait in the app.
- **Failure is a dead end for a non-developer.** The catch path toasts "Import failed
  — see console." In the packaged Electron app the user has no console. This pattern
  ("see console") recurs in `DraftEditor`, `PricePanel`, and `App.tsx` and is the
  single most user-hostile habit in the codebase.
- On success it toasts a summary and navigates **back to Home** — a reasonable
  landing, but the just-created drafts aren't highlighted, so the user has to hunt
  the queue for what they just made.

### Step 2 — Workspace shell (`App.tsx` + `Sidebar.tsx`)
Header: "← Home", title, "mock data · UI shell", a **Dock Chrome** toggle, theme
toggle. Left: a 300px sidebar queue (status badge, open-flag dot, "• edited"
indicator). Right: the editor pane.

Friction:
- **Dock Chrome exposes no precondition state.** Whether the real Chrome is even
  running / logged in is invisible until you toggle and receive an error toast. The
  only affordance is a hover `title`. (`Electron-only` — Plan B replaces docking with
  a native Side Panel split, so don't over-build here.)
- Sidebar and Home present two overlapping queues with different groupings. Fine, but
  the sidebar's status badge vocabulary ("grouped", "needs review") isn't explained
  anywhere the user can see.

### Step 3 — Review a flagged group (`ReviewScreen.tsx`)
Selecting a `needs_review` item (mock item 3, a multi-garment pile) shows "Photos in
this group weren't confidently clustered", the flag detail, photo tiles, and two
buttons: **Assign to item…** and **Split into new item**.

Friction — **this is the most serious dead end in the app**:
- **Both buttons are stubs** (`console.log` + "mock — no logic" toast). §5.1 makes
  "confirm, merge, split, or reassign" a core promise; today a flagged group can be
  *looked at* but not *resolved*. There is no confirm/accept-as-is action at all, so a
  low-confidence group has no path to becoming a draft from this screen.
- The review queue is therefore a roach motel: items check in, nothing checks out.
  This is independent of A1 and, I'd argue, a higher-priority gap than fill-progress.

### Step 4 — Draft editing (`DraftEditor.tsx`)
The richest screen, top to bottom: **Photos** (drag-reorder, delete, add; position 1
labeled the Grailed thumbnail) → **Title** with a high/low brand-confidence badge, a
save-state chip, and **↻ Regenerate** → **Description** with a Minimal/Standard/
Detailed detail selector (`DetailPanel`) + section chips, a mono textarea, and an
optional measurements grid → **Tags** → **Item details** (Condition, Size, Color
(Grailed), Style (Grailed), Country of origin) → **Suggested price** (`PricePanel`) →
**Disclaimers** → actions: **Copy listing**, **Mark as submitted**, **Fill listing**.

This screen is genuinely good — debounced autosave with a visible "Saved Ns ago"
chip, confidence badges, structured-description presets, comps inline. Friction is
concentrated in a few places:
- **The description auto-save persists, but measurements and `descParts` don't** on
  some paths (known schema gap — they ride in `content_json`, and the save call in
  `markSubmitted` omits `descParts`/`measurements` entirely). A user who edits
  measurements, then hits "Mark as submitted" without triggering the debounce, can
  lose them silently. See §4.
- **Regenerate is a manual chore for legacy items.** Items created before `descParts`
  existed hide the `DetailPanel` and show raw description; the only fix is the user
  knowing to click Regenerate. Nothing tells them that's why the presets are missing.
- **Two export paths, no explanation of the relationship.** "Copy listing" (assemble
  text → clipboard) and "Fill listing" (CDP autofill) coexist with no hint of when to
  use which. Copy is arguably the safer, breaker-independent fallback but it's styled
  as the primary while Fill is `secondary` — an inversion worth a deliberate decision.

### Step 5 — Fill listing (`DraftEditor.fillListing`)
Flushes edits, toasts "Filling the form in Chrome — human-paced, takes ~20s…", awaits
`fillListing(id)`, then toasts a per-field summary.

Friction:
- **One ~20s blocking await, two toasts total** (start + end). During the fill the
  button reads "Filling…" and everything else is idle. The user can't tell whether
  title landed but photos hung, or which field the driver is on. REMAINING-WORK track
  D already names fill-progress streaming; the UX case for it is that a 20s silent
  operation against someone else's website is *anxiety-inducing precisely because the
  stakes are an account flag*.
- **The most important sentence in the app auto-dismisses.** The "NOT saved there
  until you Save as Draft or Publish" warning lives only in the success toast, which
  self-clears on a length-based timer. This is the silent-data-loss trap from the
  brief, and today it's the most under-weighted message relative to its consequence.
- **Category/size/designer are absent from this screen.** Size is a free-text input
  bound to `attributes.size` (the AI's guess string), *not* the Grailed cascade.
  There is no department/category confirmation UI, even though `types/index.ts`
  already defines `grailed_department`/`grailed_category` and comments them as the A1
  staged-confirmation gate. So today Fill covers title/desc/price/condition/color/
  style/country + photos, and the user still hand-does the single most error-prone
  part in Chrome with no in-app scaffolding. This is exactly the A1 hole; §3 covers
  where the confirmation UI should live.

### Step 6 — Mark as submitted
A manual, honor-system button that flips status to `submitted` and stamps a date.

Friction:
- **Fully decoupled from actually submitting in Chrome.** Nothing links "Mark as
  submitted" to a real publish. A user can mark-without-submitting (ghost listing in
  "Currently listed") or submit-without-marking (real listing missing from history).
  Given §5.6/§10 want history to seed a future comp source, this drift quietly
  corrupts the one dataset the tool is supposed to accumulate.

---

## 2. Prioritized recommendations

Impact = effect on listings-per-hour (or on trust/safety, noted). Effort S/M/L.
Portability per §intro.

### Quick wins (S, mostly ports)

| # | Recommendation | Impact | Effort | Ports? |
|---|---|---|---|---|
| Q1 | Make the "not saved until you Save as Draft/Publish" warning a **persistent inline banner** in the fill/dock area, not an auto-dismissing toast | High (prevents silent loss of a full fill) | S | Ports |
| Q2 | Replace every "see console" with an **inline expandable error** carrying the driver's actual message (the code already strips the IPC wrapper — surface it, don't log it) | High (turns dead ends into recoverable states) | S | Ports |
| Q3 | Remove or clearly disable the **"Check Grailed messages" stub** and the **"hide flagged (demo)"** dev toggle from shipped UI | Med (trust) | S | Ports |
| Q4 | Add a **"why is the detail selector missing?" hint + one-click Regenerate** on legacy items | Low/Med | S | Ports |
| Q5 | Include `descParts`/`measurements` in the `markSubmitted` save call and on blur, closing the in-session-only persistence gap | Med (data integrity) | S | Ports (schema work is companion-side in Plan B) |
| Q6 | On import success, **route to the new drafts** (or highlight them) instead of a bare Home | Med (removes a hunt step per batch) | S | Ports |

### Structural changes (M/L)

| # | Recommendation | Impact | Effort | Ports? |
|---|---|---|---|---|
| S1 | **Make ReviewScreen functional** — real confirm-as-is / split / reassign so flagged groups can leave the queue | High (unblocks the whole batch path §5.1) | M | Ports |
| S2 | **Staged category confirmation** in the DraftEditor as an explicit, blocking, unmistakably-a-suggestion card that gates the size/designer cascade (see §3) | High (this is the last big manual step) | L | Ports (this is the A1 payload both plans need) |
| S3 | **Fill-progress streaming** — per-field events, a checklist that fills in live (title ✓, photos 3/9…) | High (de-risks the 20s silent op) | M | Ports (UI ports; the IPC event channel is Electron-only, the content-script message bus replaces it) |
| S4 | **Batch-progress streaming** — per-group progress for `processBatch` | Med | M | Ports (same channel caveat as S3) |
| S5 | **Counterfeit-risk acknowledgment gate** before showing/using a price on flagged items (§5.3/§8.8 require it; today the flag never reaches the DraftEditor) | High (trust/safety + PRD compliance) | M | Ports |
| S6 | **Couple "Mark as submitted" to reality** — e.g. detect the post-submit Grailed URL via the existing network watch, or at minimum a confirm step, so history doesn't drift | Med (protects the §5.6 dataset) | M | Partially (URL detection is CDP/extension-specific; the coupling concept ports) |
| S7 | Don't invest in **Dock Chrome polish** (re-dock affordances, precondition states) beyond what's needed to demo v1 | — | — | **Electron-only — throwaway under Plan B** |

Rationale, briefly. The quick wins are almost all *trust surface*: the app's whole
value proposition is "you always know what I did vs. what you must still do," and
today that certainty is carried by toasts that vanish and errors that hide in a
console the user can't open (Q1/Q2). Those are cheap and they port verbatim. The
structural list is ordered by how directly each unblocks *listings per hour*:
ReviewScreen (S1) and category confirmation (S2) each remove a hard manual step that
currently has *no* in-app path; the two progress-streaming items (S3/S4) don't add
throughput but remove the anxiety/uncertainty that makes users babysit each run. S7
is called out explicitly so the team doesn't spend Plan-A effort on docking seams
that Plan B deletes — `PLANS-v1-vs-extension.md` already classifies `chrome-dock.js`
+ `dock:*` as the discarded ~150 lines.

---

## 3. Information-architecture check

**Home vs workspace split — keep it, tighten it.** The Home "triage board" (attention
/ drafts / listed) vs. workspace "one-item editor" division is sound and will port
directly to a Side Panel (Home becomes the panel's list view, workspace its detail
view). Two fixes: (a) the sidebar and Home present overlapping-but-differently-grouped
queues — align their status vocabulary; (b) surface the circuit-breaker banner inside
the workspace too, not only at the app root, since a breaker can trip *mid-fill* while
the user is deep in an item.

**Toast-vs-inline — the app over-relies on toasts for state it should show
persistently.** Transient toasts are right for "Saved", "Regenerated", "Copied". They
are wrong for: the not-server-saved warning (Q1), errors the user must act on (Q2),
fill progress (S3), and breaker state during an item. Rule of thumb to adopt: *if the
user must still do something because of it, it's inline and persistent; if it's just
confirming something finished, it's a toast.*

**Where the staged category confirmation should live (active A1 concern).** Put it in
the DraftEditor, in the **Item details** section, as its own card *above* Size — because
size/designer are meaningless until category is set and Grailed disables them until
then, so the IA should mirror that dependency. Design it so the suggestion is
*unmistakably a suggestion*:

- Render the AI's department/category as an **un-applied chip** in a visibly
  provisional state — dashed border, amber "Suggested — confirm" label — never as a
  pre-selected value in a normal-looking dropdown. A pre-filled `<Select>` reads as
  "already decided"; that's the trap to avoid.
- Require an explicit **Confirm category** click that sets *both* `grailed_department`
  and `grailed_category` (the types already gate the cascade on both being present).
  Only after confirm do Size and Designer controls enable — visually greyed until
  then, mirroring Grailed's own cascade so the model is learnable.
- **Fill listing must refuse the cascade until confirmed.** Wire the button (or a
  distinct "Fill category/size/designer" sub-action) to disable/skip the cascade with
  an inline "Confirm the category first" note rather than blind-filling. This matches
  the driver's own `selectNestedCategory` refusal-on-cross-department behavior, so the
  UI and driver tell the same story.
- Offer a "clear / not sure" escape that leaves the cascade fully manual in Chrome —
  the driver has no proven back-control for an already-set category, so the UI should
  never imply it can undo a wrong pick automatically.

This card ports to the extension unchanged; it's pure React + the `attributes` seam.
Assumption flagged: A1 is mid-build in `DraftEditor.tsx`/`autofill-driver.js`/
`grailed-selectors.json`, so treat the above as the *target shape*, and confirm the
final field names against `types/index.ts` (`grailed_department`/`grailed_category`)
before wiring.

---

## 4. Trust & safety surfacing

Is the user always certain what the app did vs. what they must still do in Chrome?
**Mostly yes on generation, no on the two highest-stakes moments.**

Working well: the app-level **circuit-breaker banner** is clear and actionable
(names §8.1, tells you to review the account and remove `data/CIRCUIT_OPEN`); the
**brand-confidence badge** (high/low, named brand) is a good honest-uncertainty
signal; **disclaimers** render in a dedicated "Verify before posting" block; the
"never submits / you submit in Chrome" message is present on the Fill row; and
`fillListing` never submits by construction, matching the non-negotiable rule.

Gaps, in priority order:
1. **Server-not-saved warning is under-weighted** (Q1). This is the one place where
   the app's action and the user's mental model diverge dangerously: the form *looks*
   filled, but a reload silently reverts to Grailed's last saved draft. A vanishing
   toast is not proportional to "you can lose a full 20s fill and not know." Make it a
   persistent banner tied to the docked/fill state that only clears when the user
   confirms they saved/published.
2. **Counterfeit-risk gate is missing from the editor** (S5). §5.3/§8.8 require an
   explicit "I've confirmed authenticity" acknowledgment before a price is shown/used
   for high-risk categories. The `counterfeit_risk` flag exists in the data (mock item
   2 carries it) and shows as a sidebar dot + Home attention row, but the DraftEditor
   never surfaces it and the PricePanel never gates on it. Right now the tool will
   happily price a possibly-counterfeit item with no acknowledgment — a PRD-compliance
   gap, not just a UX one.
3. **"Mark as submitted" makes a truth claim the app can't back** (S6). Because it's
   decoupled from real submission, "Currently listed on Grailed" can contain things
   that aren't, and the history that's meant to seed future comps drifts. At minimum
   add a confirm ("Did you publish this in Chrome?"); better, detect the submitted
   state via the existing network watch.
4. **Low-confidence signals are inconsistent.** The size-unclear warning only fires
   when size is *also* empty (`size_unclear && !size`), so an AI-guessed-but-uncertain
   size shows no caveat. Confidence surfacing should track the *source's* uncertainty,
   not whether the field happens to be blank.

---

## 5. Top 5 next investments (ordered, respecting v1 → extension)

**1. Finish A1 as a staged category-confirmation card (S2).** It's the last big manual
step, both plans need it, and it's cheapest to prove now on the CDP path already
cleared. Build it as the explicit un-applied-suggestion card in §3 that gates the
size/designer cascade and blocks Fill until confirmed. Everything about it —
components, `attributes` seam, driver expressions — carries into the extension, so
this is the highest-leverage work that is *not* throwaway. It's the one item
`PLANS-v1-vs-extension.md` explicitly says to land on v1 before the shell swap.

**2. Fix the two silent-loss traps: server-not-saved banner + descParts/measurements
persistence (Q1 + Q5).** Cheap, high-consequence, pure-port. The not-saved warning
becoming a persistent banner removes the single worst "the app looked done but wasn't"
failure; closing the `content_json` persistence gap on `markSubmitted`/blur stops
losing structured edits. Neither depends on A1 and both survive the extension swap
untouched.

**3. Make the ReviewScreen actually resolve flags (S1).** The batch path is a core
promise (§5.1) that currently dead-ends: flagged groups can be viewed but never
confirmed, split, or reassigned, so they can't become drafts at all. This gates the
throughput story more than fill-progress does — a batch that produces unresolvable
review items isn't faster, it's stuck. Ports cleanly (pure React + pipeline calls).

**4. Fill-progress streaming, then batch-progress (S3 → S4).** Neither adds raw speed,
but a 20s silent autofill against someone else's website — where the failure mode is
an *account flag* — is exactly where the user needs to see each field land and know
nothing hung. Do fill first (higher stakes, shorter, per-item), batch second. The
progress UI ports; only the Electron IPC event channel is replaced by the extension's
content-script message bus, so build the UI against a transport-agnostic event shape.

**5. Trust hardening: counterfeit-ack gate + honest error surfacing + de-stub the
header (S5 + Q2 + Q3).** Bundle the remaining trust items. The counterfeit
acknowledgment is a PRD-required gate the editor is currently missing; replacing "see
console" with inline actionable errors turns dead ends into recoverable states for a
non-developer user; and removing the dead "Check Grailed messages" stub stops teaching
the user that buttons lie. All small, all ports, and together they make the app's
central claim — *you always know what I did and what's still on you* — actually true.

---

### Explicitly out of scope / do not invest (per the v1 → extension sequence)
Docking polish (re-dock affordances, Chrome precondition states, remember-manual-size)
is `Electron-only` and Plan B deletes the docking glue outright — keep it at
"works well enough to demo v1." Likewise, don't harden the CDP *connection* layer of
the driver beyond what A1 needs; the fill *expressions* port to a content script, the
connection does not.

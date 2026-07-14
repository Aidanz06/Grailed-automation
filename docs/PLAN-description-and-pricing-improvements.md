# Feature plan — description templates, cleaner copy, NWT-aware pricing, photo order

From tester feedback. Five changes, grouped by risk. **A + C touch the
generation prompt; D touches the pricing math** — those need a sanity pass on
real items, not just typecheck. B and E are trivial UI. Read `CLAUDE.md` first;
all the non-negotiables (never submit, no invented measurements, no authenticity
claims, guarded comp provider) stay intact.

Files referenced are current: `pipeline/content.js` (generation),
`pipeline/range.js` / `priceProvider.js` / `vision.js` (pricing),
`ui/src/lib/description.ts`, `ui/src/components/DraftEditor.tsx`,
`DetailPanel.tsx`, `PricePanel.tsx`, `PhotoRow.tsx`.

---

## A. Description style templates (the headline request)

**What the tester wants:** a place to paste an example/template description so
generations match *his* voice, format, and level of detail — reachable from a
small **pencil button** by the description box.

**Current state:** `content.js generateContent(attributes)` writes text purely
from extracted attributes. There is no user-style input anywhere, and generation
runs both at **import** (batch) and on **Regenerate** — so a template must be a
*persistent setting* both paths can read, not just renderer state.

**Design (recommended: one global template for V1):**
1. **Storage.** Add a persisted "description style" setting (a single example
   listing + optional tone notes). Store it where main + pipeline can read it —
   a `settings` row in SQLite (or a small `config` file main loads), exposed via
   IPC (`settings:get`/`settings:set` → `api.getStyleTemplate()/setStyleTemplate()`).
   One global template is enough to start; per-category templates can come later.
2. **Prompt wiring.** `generateContent(attributes, { styleExample })` — when
   present, append to the prompt *below* the hard rules: *"Match the seller's
   preferred style. Example of how they write listings: «template». Emulate its
   tone, structure, and length — but use THIS item's facts, and never copy its
   specific details, measurements, or price."* Hard rules (no authenticity, no
   invented numbers) always win over the template.
3. **Pass-through.** Wire the template into both the batch path
   (`processItem.js` / batch CLI → `main.js` reads the setting) and the
   Regenerate IPC. If no template is set, behavior is unchanged (optional param).
4. **UI.** A pencil icon button in the Description section header of
   `DraftEditor.tsx`. Click → small editor (modal or inline panel) to paste/edit
   the template, with a one-liner: *"Used as a style example for all
   generations. Facts still come from each item."* Save persists the setting;
   offer **Regenerate with my style** right there so the effect is immediate.

**Risk:** medium — touches `content.js`, a new settings store, and two generation
call sites. **Scope guard:** the template is *style guidance only*; it must never
override the factual/attribute content or the safety rules. Watch for the model
copying the example's literal details — the "use THIS item's facts" clause + a
review of a few generations covers it.

**Accept:** with a template set, regenerated descriptions clearly follow its
format/tone; with none set, output is identical to today; the template survives
restart and applies to new imports.

---

## B. Default to Minimal, measurements off  (trivial)

**Current:** `DEFAULT_PROFILE` in `description.ts` = `Standard` (materials on,
condition on, measurements **on**).

**Change:** set `DEFAULT_PROFILE = { preset: 'Minimal', sections: { ...PRESETS.Minimal } }`.
`PRESETS.Minimal` is already `{ condition:true, measurements:false, rest:false }`
— so new drafts show overview + a short condition line, no measurements section.

> Decision to confirm: Minimal keeps the **condition** line on. That's usually
> wanted, and item C makes that line non-editorializing. If the tester wants
> condition hidden by default too, flip `condition:false` in the default only
> (leave the Minimal preset itself intact so the toggle still works).

**Accept:** a freshly imported draft defaults to Minimal with measurements off;
the Minimal/Standard/Detailed toggles still work per item.

---

## C. Keep descriptions simple, objective, and factually grounded

**What the tester reports (two distinct problems):**
- **Factual hallucination.** A **black** Supreme box-logo crewneck was described
  as a **"red/white colorway"** — the copy invented an attribute that's flat
  wrong. Also earlier: editorializing cosmetic wear ("faded black") that didn't
  need stating.
- **Subjective hype.** Phrases like **"modern streetwear classic"** — marketing
  fluff. Keep it simple and objective.

**Current:** the prompt asks for an overview + an "honest condition line," with no
hard rule against introducing facts beyond the provided attributes or against
promotional language — so the model both invents details (wrong color) and adds
hype.

**Change (prompt-first, mirrors the existing authenticity handling):**
1. **Ground every fact in the provided attributes (fixes the wrong color).** Hard
   rule: *state ONLY facts present in the input attributes. Never introduce a
   color, colorway, material, collaboration, era, or feature that isn't given. If
   an attribute is unknown or low-confidence, omit it — never guess.* Colors come
   from `primary_color`; if it's a black item, the copy cannot say red/white.
   (If the wrong color originated in `vision.js` extraction, verify color
   accuracy there too — but content must not amplify or invent beyond attributes.)
2. **Objective tone, no marketing language.** Ban subjective/hype phrasing —
   "modern streetwear classic," "timeless," "must-have," "grail," "elevate your
   wardrobe," "versatile," "clean," etc. Plain, factual product description only.
3. **No cosmetic editorializing.** Don't put condition/wear/aging adjectives in
   `overview`/`materials`/`fit`; genuine, sale-relevant flaws go only in `flaws`
   (off by default); the `condition` line is rating-based (*"Good used
   condition"*), not a wear inventory.
4. **Backstop scrub** (like the authenticity scrub in `content.js`): strip a
   curated list of hype phrases and standalone cosmetic-wear phrases if the model
   slips. Keep it conservative to avoid deleting real content.

**Risk:** medium — prompt behavior (and a possible `vision.js` color-accuracy
check). Verify on real items that colors/details match the photos, no hype
survives, and genuine flaws still surface when the flaws section is toggled on.
Keep authenticity + no-invented-measurement rules intact.

**Accept:** descriptions state only true, given facts (no invented colorways),
carry no marketing language, and read as plain objective product copy; real
flaws still appear in the flaws section when enabled.

---

## D. New-with-tags (NWT) awareness in price estimates

**What the tester wants:** if the item is **brand new with tags**, flag it —
it changes the fair price a lot, and used-condition comps under-price it.

**Current:** `vision.js` extracts `condition_rating` (incl. "New with tags") and
`condition_markers`; `range.js` already weights comps by
`conditionProximity(comp.condition, itemOrd)`, but Grailed's comp condition is
coarse (`is_new`/`is_gently_used`/`is_used`) and NWT/deadstock isn't treated as
the strong signal it is, nor surfaced to the seller.

> **Reported bug (2026-07):** a brand-new garment was extracted as **Used**.
> This is the root problem — one wrong condition field cascades into both the
> copy ("used condition") *and* the price (used comps). Fixing detection +
> making the override trivial is the priority; weighting/surfacing is secondary.

**Change (fix detection first, then weight + surface, do NOT fabricate an uplift):**
1. **Detection accuracy (priority).** `vision.js` is mis-rating new items as
   Used. Tighten the `condition_rating` prompt: infer **New with tags** when tags
   are visibly attached or the garment shows no wear; only choose **Used** on
   *visible* wear evidence; when genuinely ambiguous choose **Unclear**, never
   default to **Used**. Capture the tag/deadstock signal into `condition_markers`
   too. Consider a lower-stakes default (Unclear) so a wrong "Used" never
   silently sets the copy and price.
2. **Make the override obvious + propagate it.** The condition dropdown already
   exists in `DraftEditor` (New with tags / Gently used / Used / Unclear), but a
   correction currently doesn't re-run the copy or price. When the seller changes
   condition, prompt/offer to **Regenerate** the condition line and **Recompute**
   the price so the fix flows through — the cascade that hurt on the wrong value
   should help on the corrected one.
2. **Weighting.** In `range.js`, when the item is NWT, strengthen
   `conditionProximity` toward same-condition comps (heavily favor `is_new`
   sold comps; down-weight used) so the median reflects new-condition sales
   rather than being dragged down by used ones. Prefer *weighting/filtering to
   same-condition comps* over applying a blind multiplier — keep it data-driven.
   If same-condition comps are thin, lower the confidence rather than guessing.
3. **Surface it (UI).** In `PricePanel.tsx`, when `condition_rating` is NWT, show
   a clear badge (**"New with tags — priced against new-condition sales"**) and,
   if same-condition comps are sparse, a note: *"Few new-with-tags comps — this
   estimate may be conservative; new pieces often sell above used comps."* Add an
   NWT chip to the readiness/checklist too so it's obvious at a glance.

**Risk:** higher — this is pricing internals (`range.js`, possibly
`priceProvider.js` facet filtering). Do **not** touch the guarded comp provider,
cache, or circuit breaker. Re-check the estimate on a few real NWT vs used items,
and confirm the confidence math still behaves (thin same-condition comps → lower
confidence, not false precision).

**Accept:** an NWT item is visibly flagged, its estimate leans on
new-condition comps, and the seller is told when comps are thin — a used item's
behavior is unchanged.

---

## D2. Recommended price reads too low in general

**What the tester says:** the suggested price is consistently too low.

**Root cause:** `range.median` is the weighted **sold** median — what comparable
items *sold for*. On Grailed, buyers negotiate via offers, so **sale prices sit
below asking prices**; showing the sold median as "your price" tells the seller
to list at roughly the accepted-offer level, which feels (and is) low. Three
things compound it: `removeWordsIfNoResults=allOptional` broadens to cheaper,
loosely-related comps; the IQR outlier drop trims high sales; and used comps drag
NWT items (item D).

**Change (data-driven, not a blind multiplier):**
1. **Separate "sells for" from "list at."** Keep the sold median as an *expected
   sale* figure, and recommend a **list price above it** — e.g. target a higher
   percentile of the weighted sold distribution (~65–75th) or the current q75 —
   so there's built-in offer headroom. In `PricePanel.tsx` show both: **"List at
   ~$Y · typically sells ~$X."**
2. **Tighten comp relevance** so cheap, loosely-matched comps stop dragging the
   median — prefer requiring the brand/subcategory to match before falling back
   to `allOptional`, and lightly down-weight (not drop) high outliers rather than
   hard-trimming genuine high sales.
3. **Fold in item D** — NWT items should lean on new-condition comps, which alone
   will lift many low estimates.

**Risk:** higher (pricing internals `range.js` / `priceProvider.js`). Don't touch
the guarded provider/cache/breaker. Validate on several real items that the new
"list at" number matches what an experienced seller would actually post.

**Accept:** the suggested (list) price lands at or above where a seller would
realistically list; the sold-median is still shown as the expected-sale figure;
confidence math unchanged.

---

## E. Show photo order numbers (1, 2, 3…) in the editor  (trivial)

**What the tester wants:** see each photo's position number in the middle photo
bar so the upload/thumbnail order is obvious.

**Current:** `PhotoRow.tsx` tiles render `photo.label` (a stale *creation* label
like "photo 2") and only the first tile has a "thumbnail" badge — reordering
doesn't renumber anything.

**Change:** render a position badge from the **live render index** (`i + 1`) on
every tile (a small numbered chip, e.g. top-left; keep the "thumbnail" tag on
position 1, optionally as "1 · thumbnail"). Drop or de-emphasize the stale
`photo.label`. Order = upload order, so the numbers double as "this is the order
Grailed will receive them."

**Accept:** every tile shows its current 1..N position; the numbers update live
when photos are dragged/reordered or deleted; position 1 still reads as the
thumbnail.

---

## F. Autofill bug — a previous listing's photos get uploaded  (HIGH priority)

**What the tester reports:** during autofill, photos from a previous/different
listing end up on the sell form; the user must restart to get the right photos.

**Root cause:** `uploadPhotos` (driver) fills the form's **empty photo slots** on
whatever sell form the driver is targeting. If that form isn't fresh — a reused
`/sell/new` that already holds the previous item's photos, or the driver targeting
an **older sell tab** when several are open — the new photos append to the old
ones. A fresh, empty `/sell/new` is exactly why restarting fixes it. The current
"Chrome ready" check only verifies the URL is `/sell/new`, not that the form is
**empty**.

**Change:**
1. **One fresh, empty sell form per fill.** Each fill should target a newly
   opened `/sell/new` tab and that specific tab; don't fill into a reused form.
2. **Assert empty before upload.** In `uploadPhotos`, count *filled* photo slots
   first; if any exist, **abort with a clear message** ("this Sell form already
   has photos — open a fresh one") instead of appending. Never mix.
3. **Target the right tab.** If multiple sell tabs are open, target the
   newest/active one (or close stale ones); tighten "ready" to mean *fresh +
   empty*, not just the URL.

**Risk:** high (driver + tab targeting). **Priority: do this first** — it wastes
the tester's time and, worse, can put the *wrong photos* on a real listing. Keep
selectors in `grailed-selectors.json`; no submit, no new detection surface.

**Accept:** a fill always places exactly this item's photos on a fresh form; a
non-empty form is refused with a clear message rather than appended to.

---

## G. Autofill bug — designer/brand dropdown doesn't commit

**What the tester reports:** after the designer/brand (and sometimes other)
dropdowns open, the value isn't fully selected; the user has to click it
themselves.

**Root cause:** `fillAutocomplete` real-types the value, clicks the matching
suggestion `<li>`, then confirms the committed text — but intermittently the
suggestion list is still loading (network latency) or the click doesn't register
before the check, leaving typed-but-uncommitted text.

**Change (harden the existing flow):**
1. **Wait for suggestions to settle** before clicking (poll until the list stops
   changing, within the existing ~4s budget).
2. **Verify + retry.** After the click, confirm the input holds the suggestion's
   canonical value; if not, retry type→poll→click up to ~2× with small backoff.
3. **Fail clean.** On final failure, **clear the typed text** (don't leave a
   half-entered value) and report the field clearly so the user knows to pick it
   manually — the manual fallback stays, but the field isn't left in a confusing
   half state.

**Risk:** medium (driver reliability; no new detection surface). Selectors/timings
in `grailed-selectors.json`.

**Accept:** designer/brand commits reliably on the first fill in the common case;
on failure the field is left clean and clearly flagged, not half-typed.

---

## H. Title should not repeat the brand

**What the tester wants:** keep the designer/brand out of the title — e.g.
"Acne Studios Denim Jacket" → "Denim Jacket."

**Why it's reasonable:** Grailed shows the **designer field** prominently next to
the title, so repeating the brand in the title is redundant; many sellers title
by the item only.

**Change:** in `content.js`, update the title schema + system rule so the title is
**item + era/notable feature/model**, **without the designer/brand name** (which
lives in the designer field/cascade). Keep it short (<7 words). Apply to
`title_alternatives` too. (Note: this reverses the "brand-first" convention some
guides push — since the designer field carries the brand, it's defensible; if you
want both behaviors, make it a toggle/setting, defaulting to *no brand* per the
tester.)

**Risk:** low–medium (prompt only).

**Accept:** generated titles omit the designer name (e.g. "Boxy Denim Jacket,
FW18"); the brand still fills the designer field via the cascade.

---

## I. Autofill support for Grailed Smart Pricing

**What the tester wants:** the fill should also support Grailed's **Smart
Pricing** (seller enables it and sets a floor; Grailed auto-lowers toward the
floor and nudges likers).

**Framing / safety:** this is filling Grailed's **own native** setting for the
seller to review — not the app autonomously dropping prices. It stays within the
assisted-fill model: **off by default, the user opts in per item and sets the
floor**, the app fills the toggle + floor once, and the user reviews and Publishes.
No autonomous price changes, consistent with the "nothing filled the user didn't
set" cascade policy.

**Change:**
1. **Capture selectors live.** Use the phase0b probe to capture the Smart Pricing
   toggle + floor-price input on `/sell/new` into `grailed-selectors.json` (new
   `smartPricing` block) — never hardcode.
2. **Driver step.** Add a `smartPricing` fill step in `autofill-driver.js`
   (enable toggle + type floor) that runs only when the item opted in; stream it
   in the fill checklist like other fields.
3. **UI.** In `DraftEditor`/`PricePanel`, an opt-in Smart Pricing control with a
   floor input. Pairs naturally with D2: suggest the **sold-median as the floor**
   and the higher figure as the list price ("list at $Y, floor at $X").
4. **Wire** through `buildFillPayload` (main.js) and the item model/types.

**Risk:** medium–high — new form control needs live selector capture and driver
work. Must be **opt-in, never auto-enabled**, never autonomous.

**Accept:** a seller can turn on Smart Pricing per item and set a floor; the fill
sets the toggle + floor on the form; default is off; the user still reviews and
publishes.

---

## J. Editor jumps to the Review screen mid-edit (and can lose edits)

**What the tester reports:** while editing a listing, the view suddenly switched
to the "photos weren't confidently clustered" Review screen, with all the photos
lumped into one item.

**Root cause (UI/state):** `Editor` renders `ReviewScreen` whenever
`item.status === 'needs_review' || !item.content?.title`. `App.reloadItems()`
fires on **every** `batch:progress` item event (and other actions) and **replaces
the whole `items` array wholesale** — clobbering the in-memory edits of the item
being edited and swapping in the DB version. If that reload brings a status/
content change (or a background re-cluster merged photos into one review group),
the open editor re-routes to Review and unsaved edits are lost.

**Change (renderer state stability — no clustering changes):**
1. **Don't clobber the active item on background reloads.** When merging fresh DB
   items, preserve the currently-selected item's in-memory state if it's `dirty`
   (merge, don't overwrite) so edits aren't lost.
2. **Don't re-route an open draft editor to Review from a background change.** Pin
   the editor's draft-vs-review mode to the current selection; recompute that
   branch only on an explicit selection/navigation change, not on every items
   refresh.
3. **Investigate the trigger (secondary):** confirm nothing re-clusters or
   reprocesses an item the user is already editing into one merged review group.

**Risk:** medium (App/Editor state). Don't touch clustering; this is renderer
stability.

**Accept:** editing a draft is never interrupted by a background reload; unsaved
edits survive a refresh; the editor only shows Review when the user selects a
review item.

---

## K. Autofill hangs on a (collab) designer and skips photos  (HIGH priority)

**What the tester reports:** the fill hung while choosing a tricky **collab**
designer, timed out, and the **photos were never added** to the sell form.

**Root cause (driver):** in `fillListing` the field order is
title → … → category → size → subcategory → **designer** → **photos** (photos
**last**), and the `step()` wrapper is `const r = await run()` with **no try/catch
and no timeout**. If the designer `fillAutocomplete` **throws or hangs**, it aborts
the entire fill before the photos step ever runs — so photos never upload.

**Change:**
1. **Isolate every step.** Wrap `run()` in try/catch so a thrown error becomes
   `{ ok:false, reason }` and the fill **continues** to the remaining fields
   (never aborts the whole run).
2. **Time-bound every step** (Promise.race with a per-field cap) so no field —
   especially an autocomplete — can hang the fill; on timeout mark it failed and
   move on.
3. **Never let the cascade cost the photos.** Move the **photos** step *before*
   the fragile category→…→designer cascade (right after the fresh-form open), or
   otherwise guarantee it runs regardless of cascade outcome. Photos are the
   highest-value field and must not be a casualty of a flaky dropdown.
4. **Harden collab-designer matching** (extends G): collab names ("Supreme x
   Nike", "Nike x Off-White") may not match a suggestion label — normalize/relax
   matching, and on no-match fail **clean** (clear the field), never hang.

**Risk:** high (driver). **Priority: alongside F** — it costs the photos, the core
of the listing. Verify against a real collab designer.

**Accept:** a slow/failing designer never aborts the fill or drops photos; every
step is time-bounded and isolated; photos upload regardless of cascade outcome; a
collab designer either commits or fails clean.

---

## Suggested sequencing

1. **F + K** — first. They protect the **photos** (the core of the listing): F
   stops the wrong/previous photos; K stops a flaky designer from aborting the
   fill before photos upload.
2. **J** — editor stability; stops lost edits and the confusing jump to Review.
3. **B, E, H** — trivial/prompt-only wins the tester feels immediately (Minimal
   default, photo numbers, brand out of titles).
4. **C** — cleaner, objective copy (prompt-only).
5. **G (dropdown reliability)** — removes recurring manual fixups (K's step
   isolation complements it).
6. **D + D2** — the condition bug and the "too low" pricing; verify on real items.
7. **A (templates)** — biggest build (settings store + generation wiring).
8. **I (Smart Pricing)** — new driver field; needs live selector capture, do once
   the above are stable.

## Verification

- `npm run ui:typecheck` clean for UI parts.
- **F:** fill twice in a row without manually reopening the form → the second fill
  refuses a non-empty form (no mixed photos); with a fresh form each item gets
  exactly its own photos. Confirm correct-tab targeting with multiple sell tabs.
- **K:** force a designer failure/hang (e.g. a nonsense or slow collab designer) →
  the fill does NOT abort, every step is time-bounded, and **photos still upload**;
  the designer field ends clean + flagged.
- **J:** edit a draft while a background reload fires (e.g. an import streaming) →
  the editor stays on the draft, unsaved edits survive, and it does not jump to
  Review.
- **G:** run designer fills repeatedly (incl. multi-word brands like "Louis
  Vuitton") → commits without manual clicks; a slow/failed suggestion → field ends
  clean + flagged, not half-typed.
- **A/C/H:** regenerate several real drafts — style matches the template (A),
  overviews are clean and factually grounded (C), titles omit the brand (H);
  authenticity + no-invented-measurement rules intact.
- **D/D2:** compare the same item NWT vs used and against what an experienced
  seller would list at; confirm the "list at $Y / sells ~$X" split, the NWT badge,
  and graceful confidence on thin comps.
- **I:** opt in, fill, and confirm the Smart Pricing toggle + floor land on the
  form; default off; nothing enables without the user.
- Nothing touches submit behavior, the guarded comp provider, or the circuit
  breaker; login/captcha stay manual; selectors stay in `grailed-selectors.json`.

# Resale Studio — Product Requirements Document

**Status:** Draft v1
**Owner:** Aidan
**Type:** Personal tool (not a commercial product at this stage)

---

## 1. Overview

Resale Studio is a desktop application for managing the Grailed listing workflow: turning a batch of item photos into published, priced, well-written listings with minimal manual data entry. It pairs an AI-assisted sidebar (photo sorting, listing copy, price estimation) with a live, streamed view of a genuine, separately-launched Chrome browser that's driven via the Chrome DevTools Protocol (CDP) — not an embedded browser engine. This split exists because Phase 0 testing produced a hard negative: Grailed's login/captcha step reliably blocks Electron's embedded Chromium. The real-Chrome-over-CDP approach is the chosen direction based on that finding, but is itself **not yet built or validated** — see §1.1 for exactly what's proven versus assumed.

### 1.1 Current validation status (as of Phase 0 findings, 2026-07-03)

| Capability | Status |
|---|---|
| Embedded Electron browser passes Grailed login | ❌ Confirmed does not work |
| JS fingerprint/navigator spoofing helps evade detection | ❌ Confirmed counterproductive — made blocking worse |
| UA + `Sec-CH-UA` header alignment (embedded context) | ⚠️ Partial — clears the instant block, still hits an unsolvable captcha in an embedded browser |
| Real external Chrome + CDP driver launches and logs in | ❓ Not yet built |
| `navigator.webdriver === false` in a real launched Chrome | ❓ Only verified in embedded Electron (a different, less meaningful question) — real Chrome untested |
| Session persists across app restart | ❓ Untested — no successful login has occurred yet |
| CDP `Runtime.enable` protocol-level detection avoided | ❓ Untested — newly identified risk, see §8.5 |
| Session persists across CDP reconnect (fingerprint binding) | ❓ Untested — newly identified risk, see §8.4 |
| Native-setter form fill on a real sell-page field | ❓ Code written, never executed against a live page |
| Custom dropdown handling (designer/size/category/condition) | ❓ Untested, technique unknown |
| Photo/file upload injection | ❓ Untested, technique unknown |
| Real DOM selectors for sell-page fields | ❌ Not collected — only unverified placeholder guesses exist for the title field |
| CDP screencast live view | ❌ Not built — static HTML mockup only |

Treat this table as the source of truth over any narrative elsewhere in this doc that implies more has been proven than has.

This is a **personal-use tool first**. It is not being built for distribution or sale in this version. That framing matters throughout this document — several decisions below are acceptable *because* this is single-account, self-directed use, and would need to be revisited before any future productization (see §9).

## 2. Goals

- Cut the time to go from "pile of photos" to "published Grailed listing" from ~15-20 minutes/item to a few minutes/item.
- Remove the two most tedious manual steps: sorting a batch shoot into per-item groups, and writing/pricing each listing from scratch.
- Keep a human decision point before anything is written to Grailed or priced with confidence.
- Produce something durable enough to use for months, and honest enough about its risk profile to make a good call later on whether to extend it.

## 3. Non-goals (v1)

- No autonomous posting, bumping, offer-sending, or messaging — anything Grailed's Code of Conduct treats as bot-like beyond the form-fill step the user manually triggers.
- No multi-account or multi-user support.
- No authentication/counterfeit verification — the tool identifies *probable* brand/style, never confirms authenticity.
- No cross-platform listing (Depop, Poshmark, etc.) — Grailed only for v1.
- Not a commercial product. No billing, onboarding flow, or external distribution.

## 4. Core design principle: staged human confirmation

Every AI-assisted step produces a **suggestion**, never a final action:

1. Photos → suggested groups → user confirms/adjusts
2. Group → suggested attributes (brand, category, condition tags) → user confirms/edits
3. Attributes + comps → suggested price → user confirms/edits
4. Final listing content → user reviews in the sidebar
5. "Fill listing" → auto-fills the real Grailed form → **user manually reviews and clicks submit**

No step auto-advances to the next without a checkpoint the user can override. This is the mitigation underlying almost every risk in §8.

## 5. Feature scope

### 5.1 Batch photo intake & sorting
- User drops a folder or batch of photos (one photography session, multiple items) into the app.
- Each photo gets a single compact visual descriptor generated via one vision call (not pairwise comparisons — cost/latency control).
- Clustering combines two signals: timestamp adjacency (cheap, usually correct for sequential shoots) and visual similarity (catches out-of-order shots).
- **High-confidence clusters auto-accept** and appear as ready-to-process item groups.
- **Low-confidence clusters are flagged** with a visible marker and surfaced in a review queue — user manually confirms, merges, splits, or reassigns before they become items.
- Photos that appear to contain multiple garments are flagged individually rather than forced into a cluster.

### 5.2 AI listing content generation
- For each confirmed item group: generate a Grailed-style title, measurement-forward description, and up to 10 tags, following Grailed's format conventions (short titles, brand/era/silhouette-first tagging).
- Editable before use — never written directly to the page without passing through the sidebar first.
- "Regenerate" option if the first pass misses the mark.

### 5.3 Price estimation
**Two-stage design, not a single "AI guesses a price" step:**

- **Stage 1 — Attribute extraction (vision):** brand, category, color, era/style, and visible condition markers (fading, wear, stains) extracted from the photos. Framed internally as "visually resembles X," never as a confirmed identification.
- **Stage 2 — Comp lookup (data, not guesswork):** the extracted attributes query a comp data source for actual recent sold prices, and the app returns a *range*, not a single confident number.

**Comp data source — v1 decision:** Grailed sold-listing data via a scraping approach, accepted as a known ToS trade-off (see §8.1 for the specific mitigations this requires). Architected from day one behind a `PriceCompProvider` interface so a second or replacement provider (eBay's official API) can be added without touching the rest of the pricing pipeline. eBay is the planned near-term addition — either as a full replacement or as a cross-referencing second source to sanity-check Grailed-derived comps against.

- Price is always presented as an editable suggestion with a range and the comps it was based on, not an auto-applied number.
- No price estimate for categories with high counterfeit risk without an explicit "I've confirmed this is authentic" acknowledgment from the user first.

### 5.4 Review & edit sidebar
- Per-item panel: photos, generated title/description/tags, price range, and confidence flags from §5.1/5.3.
- Manual edit on every field before it's usable.

### 5.5 Grailed autofill (real Chrome, driven via CDP)
**Status: designed, not yet built or validated.** An Electron `BrowserView` runs Electron's bundled Chromium, which Phase 0 testing confirmed Grailed's login/captcha step detects and blocks outright — this is a proven negative, not a hypothesis. The planned fix, not yet implemented:

- A **genuine, separately-launched Chrome** (not Electron's engine) with its own dedicated, persistent `--user-data-dir` — separate from the user's everyday Chrome profile, so it doesn't conflict with daily browsing and stays logged in independently.
- Launched **without `--enable-automation`**, so `navigator.webdriver` stays false. This has only been confirmed inside embedded Electron so far — a real launched Chrome hasn't been tested yet, and is Phase 0's next and highest-priority step.
- **Login/captcha happens once, manually, in that real Chrome window** — this step cannot and should not be automated; it's the one point where genuine human interaction is the point, not a workaround.
- **Do not attempt any JS-level fingerprint or `navigator` property spoofing.** Phase 0 tested this directly (UA override, `Sec-CH-UA` header rewrite, `navigator.userAgentData`/`webdriver`/`platform` getter overrides) and found tampering is itself detectable and made blocking *worse*, not better — a config with the spoofing "successfully" installed was blocked harder than one where the injection silently failed. A genuine, unmodified real Chrome shouldn't need any of this in the first place; if it turns out to, that's a signal to stop and reassess rather than add more spoofing.
- After login, the app's Electron shell would connect to that Chrome instance over **CDP** and:
  - Stream a **live view** of the driven tab into the Electron UI via CDP screencast, so the experience feels like one window even though it's two separate processes. Not built — a static mockup is the only artifact so far.
  - Run the native-setter + dispatched `input`-event fill technique (required for React-controlled inputs — code is written, but has never been executed against a real Grailed page) and a `DataTransfer`-based or CDP `DOM.setFileInputFiles`-based approach for photo upload fields, executed via `CDP.evaluate`. Both unverified. **Note:** `CDP.evaluate` requires enabling the Runtime domain, which is itself a known detection vector independent of everything else in this section — see §8.5 before assuming this path is safe just because login succeeded. A browser-extension-based fill (content script, no CDP Runtime domain) is a live alternative to prototype if this proves to be a problem.
- DOM selectors should live in an external config file, not hardcoded, so a Grailed frontend change is a config edit, not a rebuild. No real selectors exist yet — see §7.1.
- User manually reviews the filled form and clicks submit themselves, inside the real Chrome window — the app never submits on its own.
- Browser-agnostic by design: a config value picks the executable path (Chrome, Edge, Brave, Arc), so this isn't hard-locked to one browser if Chrome-specific detection ever becomes an issue.

### 5.6 Local listing history
- SQLite store: items, photos, generated content, price estimates used, comps referenced, and outcome (listed/sold/price).
- Doubles as the seed data for a future self-tracked comp source (see §9).

## 6. Technical architecture

```
Electron app
├── Main process
│   ├── CDP driver (connects to a separately-launched, real Chrome)
│   ├── Screencast receiver (renders live tab view into the UI)
│   └── DOM injection execution (CDP.evaluate against the driven tab)
├── Renderer: Sidebar UI
│   ├── Photo intake + clustering review
│   ├── Listing content editor
│   └── Price estimate review
├── Renderer: Live view panel (streamed CDP screencast frames)
├── External process
│   └── Real Chrome, dedicated persistent --user-data-dir, no --enable-automation
├── Local services
│   ├── Vision calls (Claude API) — attribute extraction, photo clustering descriptors
│   ├── Text generation (Claude API) — title/description/tags
│   ├── PriceCompProvider interface
│   │   ├── GrailedScrapeProvider (v1)
│   │   └── EbayApiProvider (planned)
│   └── SQLite (items, listings, comps, history)
└── Config
    ├── grailed-selectors.json (externalized DOM selectors)
    └── browser-path.json (executable path — Chrome/Edge/Brave/Arc)
```

## 7. Data model (sketch)

| Table | Key fields |
|---|---|
| `items` | id, status, created_at |
| `photos` | id, item_id (nullable until grouped), file_path, cluster_confidence |
| `listings` | item_id, title, description, tags, price_range, submitted_at |
| `comps` | item_id, source (grailed/ebay), sold_price, sold_date, url |
| `flags` | item_id, type (low_confidence_group / multi_item_photo / counterfeit_risk), resolved_bool |

### 7.1 Selector status

`grailed-selectors.json` does not exist yet. The only candidates on file are unverified fallback guesses for the title field, never confirmed against a real page:

```
input[name="title"]
input#title
input[placeholder*="title" i]
input[aria-label*="title" i]
input[data-testid*="title" i]
```

No selectors exist for description, price, tags, size, designer, category, or the photo input. These must be captured by inspecting the actual authenticated sell page once login works — treat this as a required Phase 0 deliverable, not a Phase 1 nice-to-have, since nothing downstream can be built against guesses.

## 8. Risks & mitigations

This section is intentionally explicit rather than smoothed over — these are known trade-offs, accepted with mitigations, not blind spots.

### 8.1 Grailed Code of Conduct exposure (scraping + autofill)
Grailed's Code of Conduct names scraping and bots explicitly as groundage for suspension. This applies to **both** the comp-scraping (§5.3) and the autofill injection (§5.5). Accepted for v1 given personal, low-volume use. Mitigations:
- Rate-limit and cache comp lookups aggressively — query patterns should look nothing like bulk scraping (infrequent, small, human-paced requests, not scheduled/bulk jobs).
- Autofill is only ever triggered manually, one item at a time, mirroring how existing tools (e.g. QuickListAI) scope their own ToS exposure by never automating bumping/messaging/relisting.
- **Circuit breaker:** if the account receives any warning or flag from Grailed, immediately disable both the scraping provider and the autofill feature and fall back to fully manual copy-paste, rather than continuing to probe the boundary.
- `PriceCompProvider` abstraction (§6) means migrating off Grailed scraping to eBay's API is a swap-in, not a rewrite, if the risk calculus changes.

### 8.2 Embedded-browser detection (confirmed negative, architecture change in progress)
Phase 0 testing confirmed Grailed's login is protected by a bot-detection stack consistent with PerimeterX/HUMAN plus reCAPTCHA Enterprise. Results by embedded-Electron configuration: a default Electron user agent was blocked immediately (403 on `POST /api/sign_in`); adding a genuine Chrome UA and matching `Sec-CH-UA` headers got past the instant block and was offered a reCAPTCHA challenge, but the challenge could not be solved in the embedded context. This confirms embedded Electron cannot be the login surface, full stop. Resolution in progress: move login and page-driving to a real, separately-launched Chrome (§5.5) — not yet built.

### 8.3 Fingerprint spoofing is counterproductive (confirmed — do not repeat)
Phase 0 tested overriding `navigator.webdriver`, `navigator.userAgentData`, and `platform` via JS getters inside the embedded browser. The configuration where these overrides were confirmed *actually installed* was blocked harder (immediate 403, no challenge offered at all) than a configuration where the same injection silently failed. The property values themselves aren't what's being checked — the tampering pattern is. Mitigation: never apply navigator/fingerprint overrides anywhere in this project, including on the real Chrome in §5.5. A genuine browser shouldn't need spoofing; needing it is a signal to stop, not a problem to engineer around.

### 8.4 Session-to-fingerprint binding (identified risk, untested)
Anti-bot vendors like PerimeterX commonly bind an authenticated session to the fingerprint/context it was created under. This matters directly for the core design assumption in §5.5: log in once in a real Chrome, then have the app reconnect via CDP indefinitely afterward. If attaching CDP itself introduces any detectable delta from the exact context the session was authenticated under, the session could be invalidated on reconnect even though no automation flags were ever set. This must be explicitly tested — restart the app, reconnect via CDP, confirm the session is still valid — before anything else in §5.5 is built on top of it. If it fails, the fallback is manual re-login more often than "log in once and forget it," which changes the UX story but not the core viability of the tool.

### 8.5 CDP protocol-level detection (Runtime.enable leak) — untested, newly identified
Separate from browser fingerprinting, modern anti-bot systems detect automation at the CDP protocol layer itself. Nearly every CDP-based tool must call `Runtime.enable` to evaluate JavaScript in a page — required for our native-setter fill technique — and that command leaves a detectable trace independent of anything visible to page-level JS. This is a live, current technique (tools like Patchright and rebrowser-patches exist specifically to work around it), not a theoretical concern, and there's no reason to assume the same vendor blocking login (§8.2) stops scrutinizing after that point.

This threatens the exact untested part of §5.5: a perfectly genuine, unspoofed real Chrome could still get flagged the moment the driver issues `Runtime.enable` to run the fill script — a different failure mode from §8.3, since it happens at the protocol layer before any page script runs.

**Must be tested explicitly and early** — as its own Phase 0b step, before any fill logic is written (see §11). If it turns out to be a problem, two directions to evaluate:
- Whether `Page.startScreencast` (needed for the live view) can run without ever triggering `Runtime.enable`, keeping CDP's footprint as narrow as possible.
- A **browser-extension-based fill** as an alternative to `CDP.evaluate` for the injection step: a lightweight extension in the same real Chrome profile running the native-setter fill as an ordinary content script, with zero CDP/Runtime domain involvement. CDP would then only ever be responsible for the screencast. Worth prototyping both before committing to one.

### 8.6 DOM fragility
Grailed frontend changes will break selectors. Mitigation: externalized selector config (§7.1), screenshot-on-failure logging so breakage is diagnosable quickly.

### 8.7 Price hallucination / overconfidence
An AI-suggested number can look more authoritative than it is. Mitigation: always shown as a range with the specific comps behind it, never auto-applied, always editable.

### 8.8 Counterfeit / authentication risk
Vision brand-matching is not authentication. Mitigation: language is always "resembles," never "is," plus an explicit user acknowledgment gate before pricing high-risk categories.

### 8.9 Batch grouping errors
Auto-accepted high-confidence groups could still occasionally be wrong. Mitigation: history log (§5.6) makes misgrouped items easy to spot and correct after the fact; low-confidence threshold should be tuned conservatively at first (flag more, not less, until real-world accuracy is known).

## 9. Future considerations (explicitly out of scope now)

- Swap or supplement `GrailedScrapeProvider` with `EbayApiProvider` once the interface has been validated in v1.
- If personal use proves durable over a few months (low selector breakage, no account flags), consider extracting the content-generation + photo pipeline (§5.1, §5.2) as a standalone, ToS-clean tool — that layer alone has no scraping or injection risk and is the most viable path to anything wider than personal use.
- Multi-account support only under a "shared internal tooling for a small group operation" framing, not public distribution.

## 10. Success metrics (informal, personal-use tracking)

- Time from photo batch to published listing, before/after.
- Frequency of selector breakage per month.
- Price estimate range vs. actual sold price, tracked over time in `comps`/`listings`.
- Any account warnings or flags (target: zero — if this happens, §8.1 circuit breaker triggers).

## 11. Build roadmap

| Phase | Scope |
|---|---|
| 0a | ✅ **Done.** Embedded Electron `BrowserView` login attempt — result: confirmed does not work, and confirmed fingerprint spoofing makes it worse. Findings in §8.2/§8.3. |
| 0b | ⏳ **Not started — current priority.** Build the real-Chrome CDP driver, in this order: (1) launch real Chrome with dedicated persistent profile, no `--enable-automation`, confirm `navigator.webdriver === false`; (2) human logs in + solves captcha manually, confirm success; (3) restart app, confirm session persists; (4) reconnect via CDP after restart, confirm session *still* valid (§8.4 risk); (5) **before writing any fill logic**, test whether merely enabling the CDP Runtime domain re-triggers a challenge or flag (§8.5 risk); (6) run native-setter fill against the real title field; (7) investigate and document custom dropdown technique; (8) investigate and document photo upload technique; (9) collect real selectors for every sell-page field into `grailed-selectors.json`; (10) build CDP screencast rendering into the Electron shell. |
| 1 | MVP: single-item flow — photo in, AI content + price suggestion, manual review, manual fill/submit |
| 2 | Batch photo sorting (§5.1) with confidence-based auto-accept/flag |
| 3 | Comp pipeline (§5.3): `GrailedScrapeProvider`, price range UI, comp history logging |
| 4 | Durability pass: externalized selectors, screenshot-on-failure, SQLite history |
| 5 | Evaluate real-world stability; decide on eBay provider addition and/or content-pipeline extraction per §9 |

## 12. Current implementation state

As of the Phase 0a findings (2026-07-03):

```
~/Desktop/Grailed-automation/
├── main.js              # Electron BrowserView POC — embedded approach, does NOT log in
├── package.json         # electron ^33, "start": "electron ."
├── package-lock.json
└── node_modules/
```

`main.js` currently holds a single `BrowserView` pointed at grailed.com on a `persist:grailed` partition, a Chrome 130 UA + `Sec-CH-UA` header rewrite (the cleanest config tested, though still non-functional for login), and an untested native-setter fill script bound to a global shortcut. A `preload.js` used for the navigator-override experiment was created and then deleted after §8.3 confirmed it was counterproductive — it should stay deleted. None of this file currently reflects the §5.5/§6 target architecture; expect Phase 0b to replace most of it rather than extend it.

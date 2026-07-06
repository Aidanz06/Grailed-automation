# Photo-clustering optimization — results & decisions (2026-07-04)

Companion to `docs/clustering-methods-research.md` (the cited method comparison) and
`docs/HANDOFF-clustering-optimization.md` (the agreed plan). Covers what was built, what was
measured, and the resulting default.

## TL;DR

- Built a `GroupingStrategy` provider abstraction (`pipeline/groupingStrategy.js`) mirroring
  `PriceCompProvider`, with four strategies: baseline descriptor+Jaccard, an **improved**
  descriptor strategy (EXIF time-prior + convex fusion + conservative auto-accept), a single
  **batched-vision** call, and an **embedding** strategy (Voyage API or local CLIP). `groupBatch`'s
  return shape is unchanged.
- Built an accuracy harness (`pipeline/harness.js`) with pairwise P/R/F1, ARI, homogeneity/
  completeness, exact-group matches, and a **wrong-auto-accept** counter, over hand-labeled ground
  truth (`grailed-vision-test/ground-truth.json`, now **36 photos / 9 items** including deliberate
  near-duplicate-item pairs — two grey hoodies, two black hoodies, two soccer jerseys).
- **Measured result (offline, on faithful vision-derived descriptor fixtures, 36-photo set):**
  baseline collapses to **P=0.39, F1=0.56, 105 false-merge pairs, 2 wrong auto-accepts** (it merges
  all four hoodies into one auto-accepted blob and both jerseys into another). The improved strategy:
  **P=1.00, R=0.91, F1=0.95, ARI=0.95, 8/9 items exact, 0 wrong auto-accepts.** The no-EXIF ablation
  falls right back to P=0.39, proving the EXIF `DateTimeOriginal` prior is what separates the
  look-alikes.
- **New default:** `descriptor-improved` (no new keys, no new deps, EXIF-driven). Batched-vision
  and embeddings are implemented and unit-tested but need a live run on your Mac to benchmark.

## Environment note (why the numbers are "offline")

This work was done in a sandbox whose egress goes through a MITM proxy that **blocks authenticated
Anthropic API calls** (a request with no key reaches Anthropic and returns proper JSON; a request
carrying any `x-api-key` — real or fake — gets a plain-text `Unauthorized` from the proxy). Voyage,
Cohere, Google, HuggingFace and npm are blocked outright. So **no live model call was possible
here**, regardless of key validity.

To still measure the *code-side* improvements (EXIF prior, linkage, thresholds, auto-accept policy)
reproducibly, the harness runs against `grailed-vision-test/descriptors.fixture.json` — descriptors
hand-authored by directly inspecting each photo, mirroring what `describePhoto` would emit from a
strong vision model, filled faithfully (including the genuine cross-item overlaps) and **not** tuned
to favor any strategy. The relative deltas between clustering strategies on the *same* descriptor set
are valid regardless of descriptor source. Live model/embedding numbers come from the Mac runner
below.

## Ground truth

36 photos, 9 items (see `ground-truth.json`; verified against EXIF `DateTimeOriginal` bursts):

| item | what | photos |
|---|---|---|
| item_1 | Grey CDG PLAY hoodie | t2-01, 02, 03 |
| item_2 | Black Kith hoodie (+3 re-export dups) | t2-04, 05, 06, IMG_0986, 0987, 0991 |
| item_3 | Navy Supreme photo tee | t2-07, 08, 09 |
| item_4 | Kith × Russell Athletic LS tee (brown/mauve) | t2-10, 11, 12, 13 |
| item_5 | FC Barcelona 22/23 home jersey (Lewandowski) | test-4, test-5 |
| item_6 | Puma × AMI black joggers | IMG_0978, 0979, 0981, 0982 |
| item_7 | Black DHL hoodie | IMG_0996, 0997 |
| item_8 | PSG navy jersey (Nike, Qatar Airways) | IMG_1005, 1006, 1008, 1010, 1011, 1012, 1013 |
| item_9 | Grey Nike hoodie | IMG_1014, 1015, 1016, 1017, 1018 |

The hard cases baked in are the real merge-risk pairs: **two grey hoodies** (item_1 CDG vs item_9
Nike), **two black hoodies** (item_2 Kith vs item_7 DHL), and **two soccer jerseys** (item_5
Barcelona vs item_8 PSG) — each pair shot in a separate EXIF burst — plus tag close-ups that look
unlike their own garment, and near-identical re-export duplicates in item_2.

## Measured deltas (offline, fixtures — 36 photos / 9 items)

| strategy | P | R | F1 | ARI | homog | compl | groups | exact | merge✗ | auto | **wrong-AA** | est $/batch |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **baseline** (mtime + Jaccard, greedy) | 0.39 | 1.00 | 0.56 | 0.48 | 0.66 | 1.00 | 5/9 | 3/9 | 105 | 5 | **2** | $0.607 (opus, 36 calls) |
| **descriptor-improved** (EXIF fusion) | **1.00** | 0.91 | **0.95** | **0.95** | 1.00 | 0.96 | 10/9 | **8/9** | **0** | 7 | **0** | $0.607 (opus, 36 calls) |
| descriptor-improved — no-EXIF ablation | 0.39 | 1.00 | 0.56 | 0.48 | 0.66 | 1.00 | 5/9 | 3/9 | 105 | 0 | **0** | $0.607 |
| descriptor-improved — complete linkage | 1.00 | 0.83 | 0.91 | 0.90 | 1.00 | 0.93 | 11/9 | 8/9 | 0 | 7 | 0 | $0.607 |

Speed (offline = pure clustering compute, excludes model latency): baseline ~8 ms, improved ~44 ms —
both negligible; wall time is dominated by the vision calls, which is where strategy *structure*
matters (below).

(The original smaller 15-photo / 5-item run: baseline P=0.64 F1=0.78 with 1 wrong auto-accept;
descriptor-improved P=1.00 F1=1.00, 5/5 exact. The 36-photo set below is the meaningful one — it adds
the near-duplicate-item pairs that actually stress a visual method.)

### What the baseline gets wrong

On the 36-photo set baseline merges **all four hoodies** (grey CDG + black Kith + black DHL + grey
Nike) into one auto-accepted group and **both jerseys** (Barcelona + PSG) into another — 105
false-merge pairs, 2 wrong auto-accepts. Two compounding causes, both real:
1. `garment_type` match alone contributes 0.5 (= the join threshold), so any two hoodies (or two
   jerseys) are one nudge from merging.
2. It keys time off **filesystem mtime**, which is identical for all files (~`Jul 3 19:03`, when
   they were copied) — so its "same-session" boost fires on *every* pair, supplying that nudge.

### Why the improved strategy fixes it — and what's decisive

The improved strategy (a) drops mtime for **EXIF `DateTimeOriginal`**, (b) fuses it convexly:
`score = 0.6·visual + 0.4·time_adjacency` (exponential decay, 150 s half-life), (c) uses average
linkage + a 0.52 join bar, and (d) raises the auto-accept bar to 0.70.

The **no-EXIF ablation is the important row**: with vision+lexical only, the look-alike pairs *still*
merge (P=0.39) — two grey hoodies / two black hoodies / two jerseys have genuinely overlapping
descriptors. Only the EXIF gaps (the pairs were shot on different days or hours apart) push their
fused scores below the join bar. **EXIF `DateTimeOriginal` is the decisive signal** for separating
visually/lexically similar items shot in different sessions.

### Conservative-by-design (PRD §8.9) held throughout

- Improved recovers 8/9 items exactly with **0 wrong auto-accepts**. It auto-accepts 7 pure groups
  and **flags the 3 genuinely-ambiguous ones**: the black Kith hoodie (its divergent "KITH XL" tag
  close-up drags the mean down), the PSG jersey's main group, and the PSG "GOAT" back shot (i1013),
  which was taken ~3.6 min after the rest and split off as a lone photo. Flag more, not less.
- **Lone photos flag, they don't auto-accept:** a singleton group is more often a fragment than a
  genuine one-shot item, so singletons are kept below the auto-accept bar (this turned the i1013
  fragment from an auto-accepted spurious "item" into a review item — confirm or merge).
- **Fail-safe without EXIF:** the no-EXIF ablation mis-groups (P=0.39) but keeps **wrong-AA=0** — it
  flags the ambiguous groups instead of collapsing into auto-accepted blobs (baseline's failure
  mode). The system degrades safely.

## Cost / speed structure of the other strategies (est., 36-photo batch)

| approach | calls | est $/batch | notes |
|---|---|---|---|
| per-photo descriptor — Opus | 36 | $0.607 | current + improved default |
| per-photo descriptor — Haiku | 36 | $0.121 | ~5× cheaper; quality TBD live |
| **batched-vision — Opus** | **1** | **$0.471** | one round-trip instead of 36 → big latency win |
| batched-vision — Haiku | 1 | $0.094 | cheapest LLM option |
| embedding — Voyage multimodal-3 | 1 | ~$0.069 | continuous score; needs `VOYAGE_API_KEY` |
| embedding — local CLIP (ONNX) | 0 | $0.000 | on-device, private; needs `npm i @huggingface/transformers` |

(Anthropic image tokens ≈ w·h/750 after the 1568px long-edge cap; Opus $5/$25, Haiku $1/$5 per MTok —
see `clustering-methods-research.md` for pricing sources. Voyage $0.60/1B px.)

Batched-vision's real appeal is **latency**: one request instead of 15. Its risk (per the research
brief) is that a single generative partition has no calibrated per-pair score — mitigated here by
having the model emit a per-photo confidence + multi-item flag that feed the same conservative
auto-accept gate.

## LIVE results (36 photos / 9 items, real Anthropic calls — 2026-07-04)

The live run (real descriptors, not fixtures) is the one that decided it:

| strategy | P | R | F1 | ARI | exact | merge✗ | wrong-AA | calls | est $/batch |
|---|---|---|---|---|---|---|---|---|---|
| baseline | 0.34 | 0.67 | 0.45 | 0.36 | 0/9 | 86 | 1 | 36 | $0.94 |
| descriptor-improved | 1.00 | 0.59 | 0.74 | 0.72 | 5/9 | 0 | 0 | 36 | $0.94 |
| descriptor-haiku | 1.00 | 0.47 | 0.64 | 0.61 | 4/9 | 0 | 0 | 36 | $0.09 |
| **batched-vision** | **1.00** | **1.00** | **1.00** | **1.00** | **9/9** | **0** | **0** | **1** | **$0.24** |
| batched-haiku | 0.96 | 0.83 | 0.89 | 0.88 | 6/9 | 2 | **1** | 1 | $0.05 |

Key live finding the fixtures couldn't show: on **real** Opus descriptors, `descriptor-improved` keeps
perfect precision but **fragments** (R=0.59, 15 groups for 9 items) — real tag-close-up descriptors
vary enough to split off. `batched-vision` reasons over all 36 photos jointly, so it attaches every
tag shot + the PSG "GOAT" back to its item AND separates the look-alikes: **9/9 exact, R=1.00, 0 wrong
merges**, in **one call** at **~4× lower cost**. `batched-haiku` is cheapest but made a wrong
auto-accept (fails the safety gate); `descriptor-haiku` fragments worse.

## Decision: default = `batched-vision`

- **Default = `batched-vision`** (set in `pipeline/cluster.js` `DEFAULT_STRATEGY`; override per call
  via `opts.strategyName` / `opts.strategy`, or globally via `$GROUPING_STRATEGY`). It passed every
  gate in the decision rule and won the tiebreakers on **accuracy (R/exact), cost, and call count**.
  Needs macOS `sips` (built-in) or ImageMagick/sharp for the pre-batch downscale — already wired.
- **Fallback = `descriptor-improved`** — perfect precision and fails safe, but fragments on real
  descriptors. Use it if you ever need per-photo descriptors for another reason, or if batched-vision
  proves unstable on a shoot.
- **Determinism — CONFIRMED STABLE.** The known risk of a single generative call is run-to-run drift.
  Checked with `run-stability-check.sh` (5 fresh calls): **5/5 runs produced the identical partition,
  9/9 items exact, P=1.00, R=1.00, 0 wrong auto-accepts** (`distinct partitions: 1`, ~$1.19 total). So
  the drift risk is retired for this shoot. Re-run the stability check after any prompt/model change
  and on a genuinely new shoot. `batched-haiku`'s wrong-auto-accept is a reminder a weaker model can be
  overconfident — keep the batched call on Opus.
- **Remaining honest caveat:** still one shoot (9 items). "Perfect + stable" here ≠ "perfect forever";
  the harness + stability runner exist to re-verify on future shoots.
- **Not needed:** no new API key. Embeddings (`embedding-voyage` / `embedding-clip`) remain available
  if you later want a continuous same-object score, but batched-vision already hits the ceiling here.

## Run it live on your Mac (real accuracy + speed + $)

```bash
cd ~/Desktop/Grailed-automation
source .env.local                 # ANTHROPIC_API_KEY (+ optional VOYAGE_API_KEY)

# LLM strategies (descriptors cached under grailed-vision-test/.harness-cache so re-runs don't re-spend):
node pipeline/harness.js --live --strategies=baseline,descriptor-improved,descriptor-haiku,batched-vision,batched-haiku \
  --out=grailed-vision-test/harness-results.live.json

# Embeddings:
export VOYAGE_API_KEY=...          # add to .env.local for the hosted encoder
node pipeline/harness.js --live --strategies=embedding-voyage
npm i @huggingface/transformers    # one-time, for the local on-device encoder
node pipeline/harness.js --live --strategies=embedding-clip
```

`--refresh` is not needed; delete `grailed-vision-test/.harness-cache/` to force fresh descriptors.
Add more shoots by appending to `ground-truth.json` (and, for offline runs, `descriptors.fixture.json`)
— the harness auto-picks up whatever's labeled. A genuine multi-item photo and a couple of
visually-similar-but-distinct items would most harden the numbers (see the note to Aidan in chat).

## Scope / guardrails honored

- Changes confined to `pipeline/cluster.js`, the new `pipeline/groupingStrategy.js`, and the new
  `pipeline/harness.js` + fixtures/docs. **No UI, no autofill, `vision.js` untouched.**
- New keys read only in `groupingStrategy.js` from `.env.local` (main/CLI path) — never surfaced to
  the renderer.
- The app still never submits; grouping only ever suggests, and low-confidence groups are flagged.

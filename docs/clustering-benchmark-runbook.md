# Clustering benchmark runbook (chosen plan: benchmark-first)

Goal: pick the clustering strategy from **real** numbers instead of guessing. The
offline harness already showed `descriptor-improved` beats baseline decisively on the
labeled set; this runbook gets you live model/embedding numbers on your Mac and a rule
for whether to switch away from `descriptor-improved`.

## 0. One-time: confirm the Anthropic key works on the Mac
The key could NOT be validated from the build sandbox — that environment's proxy
blocks any request carrying an `x-api-key` header, so the key never reached Anthropic
(this is NOT evidence the key is expired). On your Mac there's no such proxy, so just
run the benchmark: its preflight makes one real call and stops with a clear message
only if Anthropic itself rejects the key. If it does, update it:

```bash
# only if preflight reports a real 401 from Anthropic:
# edit .env.local → export ANTHROPIC_API_KEY=sk-ant-...(valid)   # regenerate at console.anthropic.com
```

## 1. Run it
```bash
cd ~/Desktop/Grailed-automation
./run-clustering-benchmark.sh
```
This preflights the key, then benchmarks the strategies that use your **existing** key
(`baseline, descriptor-improved, descriptor-haiku, batched-vision, batched-haiku`),
writes `grailed-vision-test/harness-results.live.json`, and prints the decision rule.
Descriptors are cached under `grailed-vision-test/.harness-cache/`, so re-runs are cheap
(delete that folder to force fresh calls). Estimated spend for the full run on the
15-photo set is well under $1.

Optional extra encoders (only if you want to compare embeddings):
```bash
# hosted: add to .env.local → export VOYAGE_API_KEY=...   then re-run the script
# on-device (free, private):
npm i @huggingface/transformers
./run-clustering-benchmark.sh            # auto-includes embedding-clip once installed
```

## 2. Read the table
Columns that matter, in order:

- **WRONG-AA** — auto-accepted groups that mix ≥2 real items. This must be **0**. It's
  the safety metric (PRD §8.9). Any strategy with WRONG-AA > 0 is disqualified.
- **P** (pairwise precision) — the headline accuracy number for a conservative merger; a
  wrong merge is a false-positive pair.
- **R / completeness** — how fully each item is recovered (fragments get flagged, not
  mis-merged, so lower R is "safe but more review").
- **ms** — wall time (now includes real model latency). `batched-vision` should win big
  here: 1 request vs 15.
- **est$** — measured $/batch from real token usage.

## 3. Decision rule
Compare every challenger against **descriptor-improved** (the current default). Adopt a
challenger only if **all** hold:

1. `WRONG-AA == 0` (hard gate).
2. `P >= descriptor-improved's P` (no accuracy regression).
3. It wins on a secondary axis — **latency** (materially lower `ms`), **cost** (lower
   `est$`), or **robustness** (higher `R`/completeness on harder shoots).

Otherwise keep `descriptor-improved`. To switch: set `DEFAULT_STRATEGY` in
`pipeline/cluster.js` (or `export GROUPING_STRATEGY=<name>`).

## 4. Important: the current set is too easy for an accuracy verdict
`descriptor-improved` already scores perfectly on the 15-photo / 5-item set, so
batched-vision and embeddings **cannot** show an accuracy gain here — only latency/cost.
For a real robustness decision, harden the data first, then re-run:

- Add **one genuine multi-item photo** (two+ garments in one frame) — nothing currently
  exercises the `multi_item_photo` path.
- Add **two visually-similar-but-distinct items** (e.g., two black hoodies of different
  brands) — the real failure mode for any visual method.
- Add **one more full shoot** (5–8 items) so pairwise F1 isn't computed on 15 photos.

Append them to `grailed-vision-test/ground-truth.json` (and, for offline runs, add matching
entries to `descriptors.fixture.json`). The harness auto-picks up whatever's labeled.

## 5. Results template (fill from the printed table)

| strategy | WRONG-AA | P | R | ms | est$ | verdict vs descriptor-improved |
|---|---|---|---|---|---|---|
| baseline | | | | | | reference (known worse) |
| descriptor-improved | | | | | | **incumbent** |
| descriptor-haiku | | | | | | cheaper if P holds |
| batched-vision | | | | | | latency play |
| batched-haiku | | | | | | cheapest LLM |
| embedding-voyage | | | | | | if you added the key |
| embedding-clip | | | | | | if you installed the dep |

Expected shape of the answer: on today's data, keep **descriptor-improved** unless
`batched-vision` matches on P + WRONG-AA and its latency win matters to you. Revisit once
you've added the harder shoots in step 4.

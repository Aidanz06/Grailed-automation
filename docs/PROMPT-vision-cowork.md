# Prompt — cowork instance (AI vision / clustering optimization)

Paste into a cowork session in `~/Desktop/Grailed-automation`. This is a research +
prototype + evaluate task — use multi-agent orchestration.

---

You're optimizing the photo-clustering + vision layer of the Tailor Studio / Grailed
automation project (a personal-use tool that turns a batch of item photos into priced,
written Grailed listings). **Read first:** `docs/grailed-automation-prd.md` (§5.1
batch intake, §5.3 attributes, §8.9 grouping errors), `pipeline/cluster.js` (the
clustering: one vision descriptor per photo + Jaccard text similarity + a fixed
`LOW_CONFIDENCE` threshold; singletons pinned at 0.75), `pipeline/vision.js`
(`describePhoto` + `extractAttributes`, Anthropic vision), and `pipeline/processItem.js`
(how grouping feeds the per-item flow).

**Problem:** clustering photos of a shoot into per-item groups is ~80% accurate, and
batch runs are slow. Two axes to improve — **accuracy** and **speed** — without
breaking the `groupBatch(folder) → { photoCount, groups }` contract that the app and
`batch-cli.js` depend on (each group: `{ groupId, photos[], signature, confidence,
autoAccept, flags }`).

**Explicitly in scope: research whether a different API/model/method is better than
the current approach** (Anthropic vision descriptor per photo + keyword Jaccard).
Evaluate alternatives and recommend the optimal method, e.g.:
- Dedicated image-embedding models (OpenAI, Google, open-source CLIP/SigLIP, etc.)
  for visual similarity instead of text-keyword Jaccard.
- EXIF-timestamp adjacency as a strong cheap signal for sequential shoots.
- Hybrid: timestamp + visual embedding + light vision descriptor.
- Cheaper/faster vision tiers or batching multiple photos per call.
Weigh each on accuracy, latency, cost, and dependency/complexity for a single-user
tool. If a non-Anthropic API wins on the merits, say so and design for it behind the
existing interface (the project already favors provider abstraction — see the
`PriceCompProvider` pattern in §6 for the style to mirror).

**Deliverables:**
1. A research brief comparing the candidate methods/APIs with a clear recommendation
   and the tradeoffs (accuracy / latency / cost / complexity), citing sources.
2. A small **accuracy harness**: run clustering over a labeled set of real shoots
   (folders under the repo, e.g. `grailed-vision-test*`) and report precision/recall
   or a grouping-accuracy metric, so changes are measured, not guessed.
3. Implemented improvements behind the existing `groupBatch` contract, with the
   accuracy + speed deltas measured by the harness.

**Constraints:** single-user tool, cost-aware (don't design for scale it won't hit);
keep the `groupBatch` return shape stable; conservative auto-accept (§8.9: flag more,
not less — borderline groups should go to "Needs review", not be silently
mis-grouped); no navigator/fingerprint spoofing anywhere (unrelated to this layer but
a project-wide rule). Secrets are in `.env.local` (`ANTHROPIC_API_KEY`; add any new
provider key there, main-process/CLI only — never in the renderer).

Note: autofill (Slice 6) is being built in a separate code instance — stay in
`pipeline/cluster.js` + `pipeline/vision.js` (+ a harness + any new provider module);
don't touch the UI or autofill work.

Start by proposing the research plan (candidate methods to evaluate + how the
accuracy harness will be built and labeled), then execute it.

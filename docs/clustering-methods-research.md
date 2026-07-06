# Photo-Grouping Approaches: Technical Decision Brief

**Task:** Cluster a small batch (10–40) of resale-clothing photos from one shoot into per-garment groups (multiple angles + tag close-ups per item). This is **same-object / near-duplicate grouping**, not semantic category search. Priority: raise accuracy above the ~80% baseline and speed things up, with **conservative auto-accept** (flag a borderline group for human review rather than wrongly auto-merge).

_Researched 2026-07-04. Pricing/spec citations verified against loading official pages where noted; unconfirmable numbers are flagged as such._

---

## 1. Baseline — per-photo LLM text descriptor + Jaccard

The current approach makes one cheap vision call per photo to emit a text descriptor (garment type, colors, brand text, signature phrase), then clusters in code via Jaccard token overlap plus a timestamp-adjacency boost. This is cheap and transparent, but it has two structural ceilings. First, it discards the pixels: two photos of the *same* jacket from different angles may share few descriptor tokens (front vs. back, tag close-up vs. full garment), so Jaccard under-merges — while two *different* black tees share many tokens and over-merge. Lexical overlap is a weak proxy for "same physical object." Second, one call per image means latency and cost scale linearly with batch size, and descriptor quality on a small/cheap model is the accuracy bottleneck.

On cost/latency of one vision call per image: a frontier vision model gives better descriptors but costs meaningfully more per image and adds hundreds of ms to seconds of latency per call, whereas a small vision model (e.g., a Haiku-tier or Gemini Flash-tier model) is cheap and fast but produces noisier tokens. Either way, **N images = N calls**, so a 40-photo shoot is 40 sequential-or-parallel calls. The descriptor approach is a reasonable *feature extractor* but a poor *similarity metric* — which is exactly what image embeddings fix.

---

## 2. Single batched multimodal call — all photos, model assigns group IDs

Here you put every shoot photo in one message and ask the model to return group assignments directly (e.g., JSON mapping filename → group ID). The appeal is that the model reasons jointly across all images and can exploit fine visual cues (same stitching, same tag) that a per-image descriptor throws away — potentially higher accuracy than lexical Jaccard.

The problems are cost, limits, and reliability. **Image-count and context limits:** frontier vision models cap images per request and count each image as a large token block. Anthropic's Claude API allows up to 100 images per request but recommends resizing and warns that many high-res images consume the context window quickly (https://docs.claude.com/en/docs/build-with-claude/vision); Google's Gemini API documents per-request media limits and per-image tokenization (https://ai.google.dev/gemini-api/docs/image-understanding); OpenAI similarly tokenizes each image by tiles (https://platform.openai.com/docs/guides/vision). For 10–40 images this is within limits but expensive — you pay for all images plus a large reasoning output in one shot. **Reliability of a stable grouping** is the bigger concern for a *conservative* pipeline: a single generative call can hallucinate a group, split one garment across two IDs, or return a different partition on re-run (non-determinism), and it gives you no continuous similarity score to threshold on — so you cannot cleanly implement "auto-accept only high-confidence merges, flag the rest." You get a partition, not calibrated confidence. This makes batched-call attractive as a **second-opinion / tie-breaker** on ambiguous pairs, but riskier as the sole conservative decision-maker unless you have it emit a per-photo confidence you can gate on.

---

## 3. Image embeddings + cosine similarity + clustering

This is the approach best matched to same-object grouping: embed each image into a vector, and near-duplicates/same-object shots land close in cosine space. It gives you a **continuous similarity score**, which is exactly what a conservative auto-accept policy needs (high threshold = auto-merge, mid-band = flag for review).

### Hosted multimodal embedding APIs (verified July 2026)

A cross-cutting fact confirmed against every provider's request schema: **none of these APIs accept EXIF, timestamp, or camera metadata** — they embed pixels only. Any time-prior fusion (Section 4) happens in your own code.

- **Voyage AI — voyage-multimodal-3** (now under MongoDB; pricing live). Dimension **1024** (fixed; the newer voyage-multimodal-3.5 adds 256/512/2048), 32k-token context. Billed by text tokens + image pixels: **$0.12 / 1M text tokens** and **$0.60 / 1B pixels**, with a large free tier. Per-image economics from the loaded pricing table: ~**$0.0006 for a 1000×1000 image**, capped ~$0.0012 for images >2M px (downsampled). No published numeric latency or RPM on the pricing/multimodal pages. Verified: https://docs.voyageai.com/docs/multimodal-embeddings and https://docs.voyageai.com/docs/pricing.
- **Cohere — Embed v4 / v3 multimodal.** Dimensions confirmed on docs: **embed-v4.0 = 256/512/1024/1536 (default), 128k context, multimodal**; embed-*-v3.0 = 1024; light-v3.0 = 384. Billing mechanism confirmed (images counted/billed as images). **Per-image/per-token dollar price could NOT be confirmed from a loading official page** — cohere.com/pricing renders only dedicated "Model Vault" instance pricing (e.g., Embed 4 Small $4.00/hr), not a pay-as-you-go Embed rate. Third-party calculators report ~$0.12/1M text and ~$0.47/1M image tokens, unverifiable against a Cohere-hosted page. Verified docs: https://docs.cohere.com/docs/cohere-embed and https://docs.cohere.com/docs/multimodal-embeddings; pricing caveat: https://cohere.com/pricing.
- **Google Vertex — multimodalembedding@001.** Dimension **1408 default (128/256/512 configurable)**; images resized to 512×512 before embedding. **Per-image dollar price could NOT be confirmed from a loading official page** — neither https://cloud.google.com/vertex-ai/generative-ai/pricing nor https://cloud.google.com/vertex-ai/pricing renders an embeddings row (only storage $ figures appear). Widely reported third-party figure: ~$0.0001/image (~$0.10 per 1,000 images), unverified against a Google-hosted page. Spec verified: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/embeddings/get-multimodal-embeddings.
- **Jina — jina-clip-v2 / v1.** jina-clip-v2 = **1024 output** with Matryoshka truncation to 768/512/256/128/64, 865M params, 512×512 image tiles, 8k text context (v1 = 768-d). **Rate limits confirmed on the live page**: free 100 RPM / 100k TPM, paid 500 RPM / 2M TPM, premium 5,000 RPM / 50M TPM. Latency listed as "depends on input size." **Per-token dollar price NOT confirmable** — the pricing page is a JS slider with no static figure; third-party sources say ~$0.02/1M tokens with a 10M free trial. Verified: https://jina.ai/models/jina-clip-v2/ and https://jina.ai/embeddings/.

At 10–40 images per shoot, **all of these are effectively free-tier or sub-cent per batch** — cost is not the deciding factor; accuracy, latency, and operational simplicity are.

### Local / open models (Node on a Mac, no GPU)

transformers.js runs models via ONNX Runtime and is officially supported server-side in Node (`@huggingface/transformers`, Node 18+), using the native `onnxruntime-node` CPU backend (https://huggingface.co/docs/transformers.js/index, https://huggingface.co/docs/transformers.js/tutorials/node).

- **OpenAI CLIP** — ViT-B/32 (**512-d**, ~151M params) and ViT-L/14 (**768-d**, ~0.4B params). Paper: https://arxiv.org/abs/2103.00020; cards: https://huggingface.co/openai/clip-vit-base-patch32, https://huggingface.co/openai/clip-vit-large-patch14. A ready Node/ONNX port with quantized weights exists: https://huggingface.co/Xenova/clip-vit-base-patch32.
- **OpenCLIP** — open re-implementation with a large checkpoint zoo (LAION/DataComp), many Apache-2/MIT-licensed, some stronger than OpenAI's originals (e.g., ViT-L/14 DataComp-XL ~79% ImageNet zero-shot). https://github.com/mlfoundations/open_clip.
- **SigLIP / SigLIP 2** — SigLIP base = **768-d**, ~0.2B params, Apache-2.0 (https://huggingface.co/google/siglip-base-patch16-224); its **sigmoid loss** (paper https://arxiv.org/abs/2303.15343) improves zero-shot over same-size CLIP and behaves well at small batch sizes. SigLIP 2 (https://arxiv.org/abs/2502.14786) "outperform[s] their SigLIP counterparts at all model scales," released at ViT-B (86M), L (303M), So400m (400M), g (1B).

**Throughput on Apple Silicon CPU:** quantized CLIP ViT-B/32 via `onnxruntime-node` runs roughly ~50–200 ms/image single-threaded, so a 10–40 image batch finishes in ~single-digit to ~10 s end-to-end; ViT-L/14 and SigLIP-L are several times slower. (These are engineering estimates — no official CPU-throughput table was found.)

### Clustering algorithm (unknown item count, small N, conservative)

- **Threshold agglomerative (complete linkage, `distance_threshold`, n_clusters=None)** — best fit. Discovers k automatically; complete linkage is the most conservative (won't merge a cluster unless *every* cross-pair is close); deterministic; trivial at this scale.
- **Connected-components on a thresholded similarity graph** — simplest to code, but prone to *chaining* (A~B, B~C transitively merges A and C), which is anti-conservative; mitigate with a high threshold or mutual-kNN edges.
- **Chinese Whispers** — the real face-clustering precedent: dlib clusters 128-d face embeddings with a ~0.6 distance threshold to auto-discover how many people are present (http://blog.dlib.net/2017/02/high-quality-face-recognition-with-deep.html; paper https://aclanthology.org/W06-3812/). Auto-finds k but is randomized (non-deterministic) and chaining-prone.
- **HDBSCAN** — powerful and gives free noise labels (https://hdbscan.readthedocs.io/, https://arxiv.org/abs/1911.02282), but **fragile at N=10–40**: density estimation needs more points per cluster, so items degrade to noise unless you force `min_cluster_size=2`, at which point it's just threshold clustering with more machinery.

The "conservative merge" behavior in all four comes from **one lever: a high similarity threshold** (plus complete linkage), tuned on a few known-item photo sets rather than a default.

---

## 4. EXIF DateTimeOriginal as a fused time-prior

`DateTimeOriginal` is the canonical capture-time EXIF tag (CIPA/JEITA DC-008; https://en.wikipedia.org/wiki/Exif, https://cipa.jp/e/std/std-sec.html), written once by the camera and travelling *inside* the file — so it survives copy/download/export, unlike filesystem mtime, which nearly any file operation resets. It's the best available capture-time signal but a **noisy prior** (camera-local time, pre-2.31 no timezone), not ground truth. Read it with ExifTool (https://exiftool.org/TagNames/EXIF.html) or Pillow.

Time-prior fusion has solid precedent: **Cooper et al., "Temporal Event Clustering for Digital Photo Collections"** (ACM TOMM 2005, https://dl.acm.org/doi/10.1145/1083314.1083317) partitions collections on temporal *and* content similarity; **Platt et al., "PhotoTOC"** (MSR-TR-2002-17, https://www.microsoft.com/en-us/research/publication/phototoc-automatic-clustering-for-browsing-personal-photographs/) clusters on "creation time and the color." Because the embedding APIs take pixels only, you fuse in your own code: `score = α·cosine(visual) + (1−α)·time_adjacency(Δt)`, where `time_adjacency` decays with the `DateTimeOriginal` gap (Gaussian/exponential kernel, or a hard "same burst within N minutes" gate). Since a single garment's angles + tag shots are captured seconds apart, a strong time prior is highly discriminative here — and it's *free* signal you already have.

---

## Evaluation methodology (ground-truth groups known)

Evaluate over **pairs of items** (a pair is "positive" if both are in the same cluster): **pairwise precision** = correct co-grouped pairs / all co-grouped pairs the system produced; **recall** = correct co-grouped / all truly-together pairs; **F1** = their harmonic mean (same pair-counting logic underlying the Rand index, https://scikit-learn.org/stable/modules/clustering.html#rand-index). For a *conservative-merge* pipeline, **lead with pairwise precision** — a wrong merge is exactly a false-positive pair. Report **Adjusted Rand Index** as the chance-corrected headline (https://scikit-learn.org/stable/modules/generated/sklearn.metrics.adjusted_rand_score.html; Hubert & Arabie 1985), because on small N raw F1/Rand look deceptively high. Use **homogeneity vs. completeness** (https://scikit-learn.org/stable/modules/clustering.html#homogeneity-completeness-and-v-measure; Rosenberg & Hirschberg 2007, https://aclanthology.org/D07-1043/) as the interpretable diagnostic: a conservative merger wants **high homogeneity** (pure clusters) even at some cost to completeness (one item fragmenting).

---

## Recommendation (ranked for this use case)

The baseline's core flaw is using *lexical* similarity as a proxy for *visual* sameness. Move to embeddings + a thresholded score, keep the time-prior, and keep auto-accept conservative via a high threshold with a mid-band "flag for review."

1. **Recommended default (no API key, runs on the Mac):** Local **CLIP ViT-B/32 via `Xenova/clip-vit-base-patch32` on `onnxruntime-node`** → cosine similarity → **complete-linkage agglomerative clustering with a `distance_threshold`** → fused with an **EXIF DateTimeOriginal** time-adjacency prior (`score = α·cosine + (1−α)·time_adjacency`). This is free, fully local (good for a privacy-sensitive resale-account tool), fast at 10–40 images, deterministic, and — critically — produces a *continuous score* so you can auto-accept only high-confidence merges and flag the rest.

2. **If you add one API key, use Voyage `voyage-multimodal-3`:** highest-quality embeddings of the hosted options, pricing is fully verified and effectively free at this batch size (~sub-cent per shoot), fixed 1024-d, and a clean API. Swap it in as a drop-in replacement for the local encoder when you want a quality bump; the clustering + time-fusion code is unchanged. (Cohere/Vertex/Jina are viable but their exact per-image pricing could not be confirmed from a loading official page as of July 2026 — Voyage's could.)

3. **Optional third tier — batched multimodal call as a tie-breaker only:** when the embedding score lands a pair in the ambiguous mid-band, send just those images to a frontier vision model for a yes/no "same garment?" verdict. Use it to *resolve flags*, never as the primary partition — it lacks a calibrated score and can return unstable groupings.

Keep the human in the loop: auto-merge only above a high threshold tuned on a few labeled shoots, flag the mid-band, and evaluate with **pairwise precision (primary) + ARI + homogeneity**.

---

**Note on unverifiable numbers:** Cohere, Google Vertex, and Jina per-image/per-token *dollar* prices could not be confirmed from official pages that actually render them (instance-only pricing, missing rows, or JS sliders respectively); third-party figures are cited as such. All *embedding dimensions*, Voyage's full pricing, Vertex's dimension/512×512 resize, Jina's rate limits, and all model/paper citations were verified against loading official pages on 2026-07-03/04.

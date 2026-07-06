# Vision / pricing pipeline (PRD §5.3)

Standalone module: photos of one item → structured attributes → comparable sold
listings → an editable price range. **No dependency on `phase0b.js`, the Chrome
profile, or anything CDP-related** — it makes its own Claude API and HTTP calls.

## Files
- `content.js` — `generateContent(attributes)`: Grailed-style title, measurement-forward
  description (blank measurement placeholders — never invented), and up to 10 tags (PRD §5.2).
  Never claims authenticity; hedges the brand when confidence is low.
- `vision.js` — `extractAttributes(photoPaths)`: one Claude vision call per item
  (all photos in one message), returns structured attributes. Everything framed as
  "resembles", never confirmed identity (PRD §8.8). Uses `claude-opus-4-8`, adaptive
  thinking, and structured outputs.
- `priceProvider.js` — `PriceCompProvider` interface + `GrailedScrapeProvider` (plain
  HTTP against Grailed's public Algolia search) + `MockCompProvider` (synthetic comps
  for testing). `getComps(attributes) -> { comps, range }`.
- `range.js` — `computeRange(comps, attributes)`: IQR outlier drop → relevance-weighted
  (condition × size × title/era overlap × recency) 25/50/75 percentiles.
- `compGuard.js` — `GuardedCompProvider`: wraps a provider with a disk cache, human-paced
  rate limiting (persisted across runs), and the §8.1 circuit breaker. Cache hits bypass
  both the rate limit and the breaker.
- `store.js` — `openStore()`: local SQLite (built-in `node:sqlite`) implementing the §7
  schema (items/photos/listings/comps/flags). `saveItemRun`, `getItem`, `listItems`,
  `addFlag`, `markSubmitted`.
- `cluster.js` — batch photo grouping (§5.1): `describePhoto` (one cheap call/photo) +
  `clusterPhotos` (pure code: visual signature + timestamp adjacency) → per-item groups
  with confidence, `multi_item_photo` / `low_confidence_group` flags.
- `cli.js` — single item: prints `{attributes, content, range, comps}`; `--save` persists.
- `batch-cli.js` — folder → per-item groups; `--save` persists each group as a draft item.

## Run
```bash
export ANTHROPIC_API_KEY=sk-ant-...

# Test the whole pipeline now with synthetic comps (no scraping):
node pipeline/cli.js /path/to/item1.jpg /path/to/item2.jpg --mock

# Live comps (needs the Grailed Algolia search key — see below):
export GRAILED_ALGOLIA_KEY=<key>
node pipeline/cli.js /path/to/item1.jpg /path/to/item2.jpg
```
All photos passed in one invocation are treated as ONE item. `stdout` is JSON only
(pipe to `jq`); progress/warnings go to `stderr`.

## Batch intake
```bash
# Drop a whole shoot (multiple items, many angles) into a folder:
node pipeline/batch-cli.js /path/to/folder            # prints per-item groups
node pipeline/batch-cli.js /path/to/folder --save     # + persist each group as a draft item
```
High-confidence groups auto-accept; multi-garment photos and weak groups are flagged for review.

## Circuit breaker (§8.1)
If the Grailed account gets any warning/flag, stop live scraping immediately:
```bash
touch data/CIRCUIT_OPEN          # or: export RESALE_CIRCUIT_OPEN=1
```
Live comp fetches then refuse (cached comps still serve). Re-enable with `rm data/CIRCUIT_OPEN`.
Cache TTL / pacing are tunable via `COMP_CACHE_TTL_MS` / `COMP_MIN_INTERVAL_MS`.

## Getting the Grailed search key
Grailed's site searches via Algolia with a public, search-only key embedded in its
frontend. Open grailed.com, run a search, and in DevTools → Network find the request
to `*.algolia.net`; copy the `x-algolia-api-key` request header into
`GRAILED_ALGOLIA_KEY`. The app id / index / host can also be overridden via
`GRAILED_ALGOLIA_APP_ID` / `GRAILED_ALGOLIA_INDEX` / `GRAILED_ALGOLIA_HOST`.

## Known unknowns (I couldn't verify these live)
- The exact Algolia **index name**, **hit field names** (`sold_price` / `sold_at` /
  etc.), and whether the endpoint accepts non-browser requests are unverified. If live
  comps come back empty or malformed, that's the first place to look — the hit mapping
  in `GrailedScrapeProvider.getComps` is written defensively but may need adjusting
  against a real response. `--mock` always works for exercising the rest of the pipeline.
- Scraping is an accepted ToS trade-off for personal use (PRD §8.1): keep it
  rate-limited, cached, human-paced, and honor the circuit breaker.

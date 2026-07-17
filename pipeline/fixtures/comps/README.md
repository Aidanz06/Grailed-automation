# Comp-recall eval fixtures

Cases for `npm run test:comps` — each pins a REAL sold Grailed listing the comp
pipeline must find (recall) and price near (tolerance). This is the direct
regression net for the tester's "an identical Isoknock hoodie sold on Grailed
but the comps missed it."

```
<case>.json
  attributes         extraction output (brand / model / visible_text / comp_query…)
  known              { url, price, title } — a real sold Grailed listing
  expectTier         optional: which tier must win ('narrow' | 'broad')
  recallK            top-K window for recall (default 10)
  priceTolerancePct  allowed |recommended − known| in % (default 30); null → skip
                     (use null where one sale isn't representative, e.g. colorway-
                     heavy sneaker models)
  canned             { narrow: [...], broad: [...] } — REAL Algolia responses,
                     fetched once through the guarded provider and committed, so
                     the dry-run is offline and deterministic
  cannedFetchedAt    when the canned responses were captured
```

## Run it

```
npm run test:comps:dry    # offline — replays the committed real responses
npm run test:comps        # LIVE — guarded provider (needs GRAILED_ALGOLIA_KEY;
                          #        cache + rate-limit + circuit breaker apply)
node pipeline/eval/comps.js --case=isoknock-brown-hoodie --dry-run
node pipeline/eval/comps.js --gate    # exit 1 on failure
```

## The seeded cases

| Case | What it proves |
|---|---|
| `isoknock-brown-hoodie` | niche brand: `visible_text` → narrow query finds the exact sale the broad query missed (canned.broad is the real broad response — the known listing is absent from it) |
| `chrome-hearts-horseshoe-tee` | brand + `model` narrow query returns real sold twins; recommended price lands near the known sale |
| `nike-dunk-low` | model captured → real Dunk Low sales returned (price check skipped: colorway variance) |

## Add a new case (every real miss the tester reports)

1. Get the item's extraction attributes (or hand-write them the way vision
   should have answered).
2. Find the known sold listing on Grailed (URL + price).
3. Seed `canned.narrow`/`canned.broad` by running the live eval once
   (`node pipeline/eval/comps.js --case=<name>`) or a one-off guarded
   `getCompsTiered` call, and commit the returned comps.
4. `npm run test:comps:dry` must pass.

Canned responses age (recency weights decay); refresh them if a price check
starts drifting — the recall assertion doesn't age.

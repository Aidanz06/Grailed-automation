# Identification eval fixtures

Ground-truth cases for the AI identification eval (`npm run test:identify`).
Each folder is one item.

```
<case-name>/
  expected.json        what the AI SHOULD extract (ground truth)
  sample_response.json a canned extractAttributes output — used by --dry-run
  item-1.jpg …         the item's photos — used by the LIVE run
```

## Run it

```
npm run test:identify:dry     # no API key, no real photos — scores sample_response.json
npm run test:identify         # LIVE: real extractAttributes (needs ANTHROPIC_API_KEY + real photos)
node pipeline/eval/identify.js --runs=5 --gate   # LIVE stability + CI-style gate
node pipeline/eval/identify.js --case=nike-dunk-low   # one case
```

The dry-run scores the committed `sample_response.json` files, which mimic the
**current buggy output on purpose**, so the harness visibly catches the tester's
bugs (Nike/Isoknock → "unclear" brand, Dunk model missing, NWT rated Used). For
**real accuracy numbers, replace the placeholder `item-1.jpg` in each folder with
the tester's actual photos of that item** and run `npm run test:identify`.

## The seeded cases (from real tester failures)

| Case | What it catches |
|---|---|
| `nike-dunk-low` | brand + silhouette not identified; "high top sneaker" not mapped |
| `isoknock-brown-hoodie` | niche brand → "unclear" → exact comp unfindable |
| `nwt-graphic-tee` | new-with-tags mis-rated "Used" (the hard NWT rule) |
| `supreme-cdg-collab` | collab handled right (brand = primary, partner in `collaboration`) |
| `carhartt-detroit-jacket` | baseline good case (brand + model) |

## `expected.json` schema

```jsonc
{
  "brand": "Nike",                 // "" or "unclear" → brand field is skipped
  "brand_min_confidence": 0.6,     // correct label but lower confidence = a miss (copy would hedge)
  "model": ["Dunk", "Dunk Low"],   // [] → skipped; passes if any term appears in model/subcategory/search_keywords
  "collaboration": "",             // "" → skipped
  "category": "footwear",
  "subcategory_any": ["sneakers", "high top sneakers"],  // passes if actual matches ANY
  "condition_rating": "Gently used",  // exact; NWT→"Used" is a hard violation
  "primary_color": "brown",        // "" → skipped
  "size": ""                       // "" → skipped
}
```

## Add a new case

1. `mkdir pipeline/fixtures/identification/<my-case>`
2. Drop the item's real photos in it (`item-1.jpg`, `item-2.jpg`, …).
3. Write `expected.json` (schema above).
4. Optional: add a `sample_response.json` so it runs in `--dry-run` too.
5. `npm run test:identify --case=<my-case>` (live) or `:dry`.

Add every real miss the tester reports as a fixture — that's how the eval grows
into a regression net for the vision prompt.

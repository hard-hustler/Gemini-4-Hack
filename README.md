# Dry Run

Turn a factory plan into a 3D simulation you can test, edit and benchmark,
version against version, before anything is built.

Built at the Gemini 4 hackathon. TypeScript everywhere: Vite + React +
react-three-fiber for the 3D floor, a small Node server to proxy model calls,
and deterministic engines as pure functions with unit tests.

## Run

```bash
npm install
npm run dev     # web on :5173, api on :8787
npm test        # engine unit tests
```

Put `GEMINI_API_KEY=...` in `.env` (see `.env.example`). Without a key the
3D view, drag edits and engines still work; only the model buttons fail.

## The flow

1. **Landing**: start a project, or open the built-in demo floor (no key needed).
2. **Brief**: a prompt, a sketch photo, a PDF, or a voice note, in any mix.
3. **Equipment**: the harness shows the plan it read and the machine it will use
   for each step. Edit quantities, the floor and demand, or swap any machine for
   a real Shop listing.
4. **Simulation**: a valid layout in 3D, simulated over 30 shifts. Drag, type or
   speak edits, ask for improvements, save and compare versions.

## Harness design

Builders propose; checkers decide. Models never emit coordinates.

| Stage | Who | Output | Checked by |
| --- | --- | --- | --- |
| Read + plan | `gemini-4-hydrogen` | `Requirements` (steps, counts, floor, demand, walls) | `checkRequirements()` in code; errors fed back, up to 3 attempts |
| Equip | catalog lookup | `EquipmentLine[]` | the user, on the Equipment screen |
| Check | `gemini-decision-1` | per-step "is this in the brief?" and a coverage score | independent of the planner: it sees only the brief |
| Convert | `gemini-4-hydrogen` + `gemini-decision-1` | Shop listing -> `CatalogItem` with a suitability score | the user |
| Place | `src/engines/place.ts` | `FactorySpec` | `validate()`: a layout is valid by construction or the placer says why not |
| Simulate | `src/engines/simulate.ts` | metrics | queue-theory check in the eval |
| Improve | `gemini-4-neon`, or a Managed Agent running the seeded search in a sandbox | candidate op lists | `validate()`, Decisions gate, then the simulator |
| Edit | `gemini-4-hydrogen` | edit ops from text or voice | `validate()`, errors fed back |

Every stage appends a `TraceEvent`; the dark tracker in the UI is that trace,
and clicking it opens the run log.

Why this shape: in the eval below, a model placing stations directly was valid
60% of the time and gained little over random starts once a search ran. So the
model now decides what goes on the floor and code decides where.

## Seams for the other workstreams

All shared types are in `src/contracts.ts`.

- **Catalog and 3D look**: replace the data in `src/catalog.ts`. Give any
  `CatalogItem` a `modelUrl` (GLB) and the scene draws it, scaled to the
  footprint, instead of the procedural model (`src/ui/Equipment.tsx`).
- **Shopify search and buying**: `POST /api/catalog/search {query}` returns
  `ShopListing[]`; `POST /api/catalog/convert {listing, step}` returns a
  `CatalogItem`. Stations carry `listingUrl` and `checkoutUrl` through to the
  bill of equipment in the simulation.
- **Listing -> 3D conversion**: set `modelUrl` on the item returned by
  `convertListing()` in `server/harness.ts` (marked in the code).

## Engines

| Engine | File | What it does |
| --- | --- | --- |
| validate | `src/engines/validate.ts` | overlaps, 1.2 m minimum aisle, docks on walls, forklift reachability, utility run limits; returns specific errors with station ids |
| place | `src/engines/place.ts` | requirements + equipment -> valid layout: as drawn when there is a sketch, otherwise a centred flow line |
| route | `src/engines/route.ts` | A* on the floor grid for each leg of the product flow; Manhattan power and water runs |
| simulate | `src/engines/simulate.ts` | discrete-event line sim, 30 seeds, forklifts as a shared resource; low/median/high are p10/p50/p90 |
| search | `src/engines/search.ts` | seeded hill climb through validate + simulate |
| cost | `src/engines/cost.ts` | build cost, cost per unit, kWh per unit, forklift travel per hour |
| versions | `src/engines/versions.ts` | saved specs with metrics, parent and diff; compare any two |

## Eval results (run of 2026-11-21, before the placer existed)

| Check | One model call | Harness |
| --- | --- | --- |
| QAPLIB Nugent gap to best-known (nug12 / 15 / 20 / 30) | 18.3% / 36.5% / 8.0% / 13.4% | 0% / 0.9% / 1.3% / 1.6% |
| Valid layouts on 10 unseen plans | 60% | 100% |

Simulator vs M/M/c queue formula: within 4% in all four cases.

Where it breaks: on QAP most of the harness gain comes from the local search,
not the model (the same search from a random start reaches 0% / 1.4% / 2.3% / 2.8%).
One "valid" plan came back with a different number of stations than the plan
asked for: validate() checks geometry, not faithfulness to the input.

## Known rough edges

- The eval's validity check measures the old path where the model emitted
  coordinates (`readPlan`). It has not been re-run against the placer.
- A plan can still be valid but unfaithful (wrong station count). The
  Decisions check on the Equipment screen flags doubtful steps but does not
  block.
- In-browser mic capture is untested; the voice path was tested by posting a
  WAV clip to the server.
- Neon takes 40 to 80 s to propose six candidates.
- The sim charges forklift time only for loaded travel, and aisle width is not
  checked against walls.
- Built-in equipment models are procedural placeholders.

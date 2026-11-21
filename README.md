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
| Design a machine | `gemini-4-hydrogen` reads the listing photo and text | a `MachineRecipe`: archetype, size, colours, features (never geometry) | `checkRecipe()` in code, errors fed back up to 3 times; then `gemini-decision-1` confirms the archetype and each feature against the photo, sends a contradicted archetype back once, and drops features it cannot see |
| Place | `src/engines/place.ts` | `FactorySpec` | `validate()`: a layout is valid by construction or the placer says why not |
| Simulate | `src/engines/simulate.ts` | metrics | queue-theory check in the eval |
| Improve | goal-driven loop (`server/improve.ts`): `gemini-4-neon` proposes for a goal, seeing what earlier rounds tried and how each turned out; a seeded search competes with it; or a Managed Agent runs the search in a sandbox | candidate op lists | `validate()`, Decisions gate, then the simulator; a change is kept only if it beats the current layout, and the loop stops when a round finds nothing better |
| Edit | `gemini-4-hydrogen` | edit ops from text or voice | `validate()`, errors fed back |

Every stage emits a `TraceEvent`, streamed to the browser as newline-delimited
JSON while the call is still running. The dark tracker shows the step in
flight; "Run log" in the top bar keeps every step taken on the project. Each
change the improve loop keeps is saved as its own version.

Why this shape: a model placing stations directly needed up to three attempts
to pass the layout rules, and on the layout benchmark its starting point added
little once a search ran. So the model decides what goes on the floor and code
decides where. The Decisions check can also send a station count that
contradicts the brief back to the planner for one revision.

## Machine catalog

A machine is a recipe, not a mesh (`src/machines.ts`): one of 12 archetypes
(bench, table, rack, cabinet, machine, enclosure, conveyor, cart, tank, press,
kiosk, robot), a size in metres, four colours from a fixed palette, and a list
of features each archetype is allowed to carry. `buildParts()` turns a recipe
into positioned boxes and cylinders. The model says what the machine has; code
decides where every part goes, so a machine is always exactly its stated size
and every machine shares one look.

`server/recipes.ts` converts a Shop listing: about 6 s per listing in testing,
with the photo read and every kept feature confirmed by the Decisions API. The
`recipeChecks` on the item record what was confirmed, what was dropped and
why, and whether the size was stated or estimated. The Catalog screen shows
every built-in machine and every archetype.

## Seams for the other workstreams

All shared types are in `src/contracts.ts`.

- **Catalog and 3D look**: add archetypes, features or parts in
  `src/machines.ts`, or replace the built-in items in `src/catalog.ts`. Any
  `CatalogItem` with a `modelUrl` (GLB) is drawn instead of its recipe.
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

## Eval results (run of 2026-11-21, against the shipped harness)

`npm run eval` writes `public/eval/results.json`, shown at `/eval/index.html`.

**Layout quality, QAPLIB Nugent instances (gap to best-known):**

| Instance | One model call | Harness (model + search) | Search only, random start |
| --- | --- | --- | --- |
| nug12 | 10.7% | 0% | 0% |
| nug15 | 4.9% | 0.2% | 1.4% |
| nug20 | 6.5% | 0.2% | 2.3% |
| nug30 | 11.3% | 3.2% | 2.8% |

**Validity and faithfulness on 10 unseen briefs:**

| | One call, model places | Retry loop, model places | Plan + placer (shipped) |
| --- | --- | --- | --- |
| Valid layouts | 80% | 100% | 100% |
| Faithful to the brief | n/a | 90% | 90% |

**Simulator vs M/M/c queue formula:** within 4% in all four cases.

Where it breaks, and what the numbers do not show:

- The search does most of the work on QAP. On nug30 the model's starting point
  was worse than a random one (3.2% vs 2.8%).
- The retry loop already reached 100% valid. The placer matches it rather than
  beating it; what it adds is one planner call instead of up to three, and a
  layout in milliseconds that is the same every time.
- The placer's first version failed the three tightest briefs outright. It now
  packs flush banks, back-to-back rows and quarter-turned rows.
- The one unfaithful result is a brief that contradicts itself (no storage in
  the equipment list, but "put storage beside the dock"). Both paths added a
  storage station. Excluding it, both are 100% faithful.
- Ten briefs is a small sample: one call's validity has been 50%, 60%, 80% and
  80% across four runs today.

## Known rough edges

- A plan can still be valid but unfaithful (wrong station count). The
  Decisions check on the Equipment screen flags doubtful steps but does not
  block.
- An improve run takes about two minutes (three rounds, 30 to 40 s per Neon call).
- The microphone path was tested in the browser with a synthetic audio stream, not a physical mic.
- The sim charges forklift time only for loaded travel, and aisle width is not
  checked against walls.
- Recipes carry an operator side, but the placer does not use it yet, and
  there are no material in/out points or utility connection points.
- A recipe can only describe what the 12 archetypes and their features cover;
  anything else becomes the nearest archetype.
- A real GLB has still not been loaded through `modelUrl`.

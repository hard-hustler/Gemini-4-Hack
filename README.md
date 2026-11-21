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
3. **Equipment**: a window over the brief (or the simulation) showing the plan
   the harness read and the machine it will use for each step. Edit quantities,
   the floor and demand, swap any machine for a real Shop listing, or send one
   agent per step to source and model real equipment. A workshop or a line is
   sourced from Shop first; a whole plant is designed from the process.
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

## Plant scale

A brief is sized first (Decisions API: workshop, line or plant). A line or a
plant takes a different path through the harness:

- **Research.** Hydrogen with Google Search grounding looks up how the product
  is really made (departments, steps, cycle times, footprints, power) and
  writes notes the planner then follows. The queries and sources are shown on
  the Equipment screen.
- **Zoned plan.** Steps are grouped into departments and sized by takt, up to
  40 steps and 180 stations.
- **Engines.** A 1 m grid on large floors, each station routed to its nearest
  station of the next step instead of all pairs, and a placer that leaves
  conveyor aisles. A 111-station plant that used to fail after 22 s now places
  in 76 ms, routes in 52 ms and simulates in 0.24 s.
- **Conveyors.** Transport is by conveyor instead of forklift: units move
  continuously with no carrier to wait for, and conveyor length is costed.
  The scene draws the belts with product riding on them.
- **Equipment.** Shop does not sell paint ovens, so the swarm designs each
  machine from what its step does, with the same structural check and
  inspection. Machines on a plant are merged into a few meshes each.

Tested on "a car assembly plant that builds 30 compact electric cars an hour":
sized as a plant, researched, planned as 20 steps in 5 departments (60
stations, 180 x 120 m), every machine designed by the swarm (54 to 101 parts
each), simulated at 27.9 cars an hour against 30.

## Demos

Projects the harness generated are saved in `public/demos/` and listed in
`src/demos.ts`; the Demos screen opens any of them as a copy, with no key
needed: the electric car plant, a CNC machine shop, an espresso grinder
workshop equipped from real Shop listings, and the built-in light assembly
floor.

The machine shop is the mid-size story. One paragraph asking for 60 aluminium
bike-light housings an hour was sized as a line, researched and planned at 30
stations; the checker flagged three steps the brief never asked for and they
were removed. Eleven agents then went to Shop: nine came back with a real
listing (a Hitachi Seiki CNC lathe, a Langmuir MR-1 gantry mill, a KAKA
bandsaw, an OMTech fibre laser marker and others) and modelled it from the
listing photo; the parts washer and the CMM had no listing that fit, so those
two were designed from the process. Every listing is linked from the sourcing
view and the equipment list. Laid out on 30 x 20 m with conveyors it simulates
at 59.4 parts an hour against 60. To add one, open a
project with `?capture` in the URL and post it to `/api/dev/save` (a dev-only
endpoint that writes under `public/demos` and `public/img`). The images on the
landing page were captured the same way; all are renders of the harness's own
output.

On a plant the improve loop adds capacity with a `clone` op: a model names a
station to duplicate and code finds where the copy can legally stand. Tested
on the car plant: three rounds in 85 s, two changes kept, demand met.

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

## Sculptor swarm: detailed models from real listings

"Source real equipment" on the Equipment screen starts one agent per process
step, all at once (`src/screens/Swarm.tsx`, `server/sculpt.ts`). Each agent:

1. **Scouts** Shop for the step, has the Decisions API rank the listings for
   suitability, and widens the search until one fits well.
2. **Models** the product from its photo as a free-form part list
   (`src/model3d.ts`): boxes, cylinders, cones, spheres and rings, 35 real
   materials (painted metal, steel, chrome, glass, lit screens, hazard
   striping) and moving parts. No archetypes.
3. **Is checked in code**: the parts must fill and fit the stated envelope and
   every part must reach the floor through parts that touch. Failures go back
   to the modeller with the offending parts named.
4. **Is rendered** in the browser, and the Decisions API compares the render
   with the listing photo (likeness, coherence, proportions).
5. **Is corrected** when it falls short: an inspector lists concrete problems
   and the modeller revises, up to three rounds. The best version is kept.

In testing, five agents built five models of 19 to 57 parts in 32 to 58 s, at
77 to 84% likeness. The recipe catalog above remains for built-in machines
and as the look for anything without a model.

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
- Designing 20 plant machines took 7.5 minutes in the one full run; the limit was
  since lowered to two inspection rounds and eight agents at once, untested at that size.
- On a plant, research sometimes returns notes with no cited sources.
- On a plant the improve loop was tested through the API on a 43-station layout, not through the UI.
- An improve run takes about two minutes (three rounds, 30 to 40 s per Neon call).
- The microphone path was tested in the browser with a synthetic audio stream, not a physical mic.
- The sim charges forklift time only for loaded travel, and aisle width is not
  checked against walls.
- Recipes carry an operator side, but the placer does not use it yet, and
  there are no material in/out points or utility connection points.
- Built-in machines are still recipes (12 archetypes). Only machines sourced
  by the swarm get free-form models.
- The scout is limited by what Shop lists: for "test" it found a plain table.
- Likeness is judged from one render angle.
- A real GLB has still not been loaded through `modelUrl`.

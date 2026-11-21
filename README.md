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

## Status

- [x] **Milestone 1**: fixture spec, engines, 3D floor, drag to move, layers,
      metrics strip, version timeline with side-by-side compare. No model calls.
- [x] **Milestone 2**: `gemini-4-hydrogen` reads a sketch photo or PDF into a
      FactorySpec and turns a spoken or typed instruction into edit ops, each
      retried against `validate()` (max 3). `gemini-decision-1` (Decisions API)
      gives a per-element confidence shown on every label.
- [x] **Milestone 3**: `gemini-4-neon` explains the bottleneck and proposes six
      candidate op lists; failed ones get one repair round; the Decisions API
      gates them; survivors are simulated in parallel and ranked. Gated-out
      candidates are simulated too, so the gate can be audited.
- [x] **Milestone 4**: Shop MCP `search_catalog` prices real equipment per
      station type, reads footprints from listing text, applies prices as
      `setParam` ops, and builds a per-seller cart of checkout links
      (`server/shop.ts`). Nothing is ordered.
- [x] **Milestone 5**: `npm run eval` writes `public/eval/results.json`, shown
      at `/eval/index.html`.

## How it fits together

`src/spec.ts` defines `FactorySpec` and the six edit ops (`move`, `rotate`,
`add`, `remove`, `moveDock`, `setParam`). Every change, from a drag or from a
model, is an op applied to a spec. Only specs that pass `validate()` are ever
shown, routed or simulated.

| Engine | File | What it does |
| --- | --- | --- |
| validate | `src/engines/validate.ts` | overlaps, 1.2 m minimum aisle, docks on walls, forklift reachability, utility run limits; returns specific errors with station ids |
| route | `src/engines/route.ts` | A* on the floor grid for each leg of the product flow; Manhattan power and water runs |
| simulate | `src/engines/simulate.ts` | discrete-event line sim, 30 seeds, forklifts as a shared resource; units/hour, bottleneck, utilisation, WIP as low/median/high (p10/p50/p90) |
| cost | `src/engines/cost.ts` | build cost, cost per unit, kWh per unit, forklift travel per hour |
| versions | `src/engines/versions.ts` | saved specs with metrics, parent and diff; compare any two |

## Model jobs

| Model | Job | Where |
| --- | --- | --- |
| `gemini-4-hydrogen` | sketch / PDF -> spec; voice or text -> edit ops (JSON-schema output) | `server/pipeline.ts` `readPlan`, `editPlan` |
| `gemini-decision-1` | per-element confidence: is the thing we read really a station / dock? | `server/pipeline.ts` `scoreElements` |
| `gemini-4-neon` | bottleneck explanation and candidate improvement ops | `server/optimize.ts` |
| `gemini-decision-1` | cheap gate: score each candidate before simulation | `server/optimize.ts` |
| Managed Agent (`antigravity-preview-09-2026` on Hydrogen) | clones this repo into a sandbox and runs 8 seeded layout searches in parallel; results are re-validated and re-simulated locally | `server/agent.ts` |

All calls go through `server/gemini.ts` (Interactions API and Decisions API over REST).

## Eval results (run of 2026-11-21)

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

- Neon takes 40 to 80 s to propose six candidates.
- On the fixture the Decisions gate cut the candidate that then simulated best,
  so treat the gate as a cost saver, not a judge.

- In-browser mic capture is untested; the voice path was tested by posting a
  WAV clip to `/api/edit`.

- drei `<Html>` labels log a React "unmount a root while rendering" console
  error on re-render. Harmless, but noisy.
- The sim charges forklift time only for loaded travel; empty return trips are
  not modelled.
- Aisle width is checked between facing stations, not against walls.

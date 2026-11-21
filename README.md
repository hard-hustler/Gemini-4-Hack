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

Put `GEMINI_API_KEY=...` in `.env` (see `.env.example`). Milestone 1 needs no key.

## Status

- [x] **Milestone 1**: fixture spec, engines, 3D floor, drag to move, layers,
      metrics strip, version timeline with side-by-side compare. No model calls.
- [ ] Milestone 2: Hydrogen reads a sketch photo / document / voice into a
      FactorySpec or edit ops; Decisions API scores each element.
- [ ] Milestone 3: Neon proposes improvement ops; propose -> validate -> retry
      loop; candidates evaluated in parallel.
- [ ] Milestone 4: Shop MCP pricing and cart.
- [ ] Milestone 5: `/eval` (QAPLIB Nugent gap, validity rate, queue sanity).

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

## Known rough edges

- drei `<Html>` labels log a React "unmount a root while rendering" console
  error on re-render. Harmless, but noisy.
- The sim charges forklift time only for loaded travel; empty return trips are
  not modelled.
- Aisle width is checked between facing stations, not against walls.

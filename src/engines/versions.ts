import { dockPoint, type FactorySpec } from '../spec';
import { cost, type CostResult } from './cost';
import { route, type Routes } from './route';
import { simulate, type SimResult } from './simulate';
import { validate, type ValidationError } from './validate';

export interface Metrics {
  sim: SimResult;
  cost: CostResult;
  routeTotals: Routes['totals'];
}

export interface Version {
  id: string;
  n: number;
  parentId: string | null;
  label: string;
  createdAt: number;
  spec: FactorySpec;
  metrics: Metrics;
  diff: string[];
}

export type Evaluation =
  | { ok: true; routes: Routes; metrics: Metrics }
  | { ok: false; errors: ValidationError[] };

/** The one gate: only specs that pass validate() are routed, simulated and costed. */
export function evaluate(spec: FactorySpec, seeds = 30): Evaluation {
  const errors = validate(spec);
  if (errors.length) return { ok: false, errors };
  const routes = route(spec);
  const sim = simulate(spec, { seeds, routes });
  return { ok: true, routes, metrics: { sim, cost: cost(spec, sim, routes), routeTotals: routes.totals } };
}

export function diffSpecs(a: FactorySpec, b: FactorySpec): string[] {
  const out: string[] = [];
  const byId = new Map(a.stations.map((s) => [s.id, s]));
  for (const s of b.stations) {
    const p = byId.get(s.id);
    if (!p) {
      out.push(`added ${s.id} (${s.type}) at ${s.x},${s.y}`);
      continue;
    }
    if (p.x !== s.x || p.y !== s.y) out.push(`moved ${s.id} ${p.x},${p.y} -> ${s.x},${s.y}`);
    if (p.rot !== s.rot) out.push(`rotated ${s.id} ${p.rot} -> ${s.rot}`);
    for (const k of ['cycleTimeSec', 'operators', 'powerKw', 'needsWater', 'price', 'w', 'd', 'type'] as const) {
      if (p[k] !== s[k]) out.push(`${s.id}.${k} ${p[k]} -> ${s[k]}`);
    }
    byId.delete(s.id);
  }
  for (const s of byId.values()) out.push(`removed ${s.id}`);
  const n = Math.max(a.docks.length, b.docks.length);
  for (let i = 0; i < n; i++) {
    const p = a.docks[i];
    const q = b.docks[i];
    if (!p && q) out.push(`added dock ${i} on ${q.wall} wall`);
    else if (p && !q) out.push(`removed dock ${i}`);
    else if (p && q && (p.wall !== q.wall || p.offset !== q.offset)) {
      const pa = dockPoint(a, p);
      const pb = dockPoint(b, q);
      out.push(`moved dock ${i} ${p.wall}@${pa.x},${pa.y} -> ${q.wall}@${pb.x},${pb.y}`);
    }
  }
  if (a.demandPerHour !== b.demandPerHour) out.push(`demandPerHour ${a.demandPerHour} -> ${b.demandPerHour}`);
  if ((a.forklifts ?? 1) !== (b.forklifts ?? 1)) out.push(`forklifts ${a.forklifts ?? 1} -> ${b.forklifts ?? 1}`);
  if (a.routing.join('>') !== b.routing.join('>')) out.push(`routing ${a.routing.join('>')} -> ${b.routing.join('>')}`);
  for (const k of Object.keys(b.costs) as (keyof FactorySpec['costs'])[]) {
    if (a.costs[k] !== b.costs[k]) out.push(`costs.${k} ${a.costs[k]} -> ${b.costs[k]}`);
  }
  return out;
}

export function makeVersion(spec: FactorySpec, metrics: Metrics, parent: Version | null, n: number, label: string): Version {
  return {
    id: `v${n}`,
    n,
    parentId: parent?.id ?? null,
    label,
    createdAt: Date.now(),
    spec: structuredClone(spec),
    metrics,
    diff: parent ? diffSpecs(parent.spec, spec) : ['initial plan'],
  };
}

export interface MetricRow {
  key: string;
  label: string;
  unit: string;
  a: number;
  b: number;
  delta: number;
  /** true when b is better than a */
  better: boolean | null;
}

export function compare(a: Metrics, b: Metrics): MetricRow[] {
  const row = (key: string, label: string, unit: string, va: number, vb: number, higherIsBetter: boolean): MetricRow => {
    const delta = vb - va;
    return { key, label, unit, a: va, b: vb, delta, better: Math.abs(delta) < 1e-9 ? null : higherIsBetter ? delta > 0 : delta < 0 };
  };
  return [
    row('uph', 'Units / hour', '', a.sim.unitsPerHour.median, b.sim.unitsPerHour.median, true),
    row('lead', 'Lead time', 'min', a.sim.leadTimeSec.median / 60, b.sim.leadTimeSec.median / 60, false),
    row('wip', 'WIP', 'units', a.sim.wip.median, b.sim.wip.median, false),
    row('cpu', 'Cost / unit', '$', a.cost.costPerUnit, b.cost.costPerUnit, false),
    row('build', 'Build cost', '$', a.cost.buildCost, b.cost.buildCost, false),
    row('kwh', 'kWh / unit', '', a.cost.kwhPerUnit, b.cost.kwhPerUnit, false),
    row('fork', 'Forklift travel', 'm/h', a.cost.forkliftMPerHour, b.cost.forkliftMPerHour, false),
  ];
}

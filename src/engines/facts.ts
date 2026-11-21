// The facts of a plant that a reviewer may quote, computed once from the layout and the simulation,
// and the check that a quoted number really is one of them. A technician agent's judgement cannot be
// re-run in code; the numbers it rests on can.

import type { FactorySpec, Station } from '../spec';
import type { Routes } from './route';
import type { Metrics } from './versions';

/** What can be quoted about one machine. */
export const MACHINE_FACTS = ['power_kw', 'cycle_s', 'busy_pct', 'nearest_gap_m', 'wall_gap_m', 'supply_run_m', 'water_run_m', 'machines_of_this_kind'] as const;
/** What can be quoted about the plant as a whole. */
export const PLANT_FACTS = ['connected_kw', 'demand_per_hour', 'output_per_hour', 'conveyor_m', 'floor_width_m', 'floor_depth_m', 'machine_count'] as const;
export const FACT_KINDS = [...MACHINE_FACTS, ...PLANT_FACTS] as const;
export type FactKind = (typeof FACT_KINDS)[number];

/** One number a finding rests on: which machine (or "plant"), which fact, and the value it claims. */
export interface Cite {
  machine: string;
  fact: FactKind;
  value: number;
}

export interface PlantFacts {
  plant: Partial<Record<FactKind, number>>;
  machines: Map<string, Partial<Record<FactKind, number>>>;
  /** the closest other machine to each one, for the sheet */
  nearest: Map<string, string>;
}

/** Edge-to-edge distance between two footprints, in metres. */
export function gapBetweenStations(a: Station, b: Station): number {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.d, b.y + b.d));
  return Math.hypot(dx, dy);
}

export function plantFacts(spec: FactorySpec, metrics: Metrics, routes: Routes): PlantFacts {
  const util = metrics.sim.utilisation;
  const machines = new Map<string, Partial<Record<FactKind, number>>>();
  const nearest = new Map<string, string>();
  for (const s of spec.stations) {
    const others = spec.stations.filter((o) => o.id !== s.id).map((o) => ({ id: o.id, g: gapBetweenStations(s, o) }));
    const near = others.sort((a, b) => a.g - b.g)[0];
    if (near) nearest.set(s.id, near.id);
    const power = routes.power.find((r) => r.id === s.id)?.length;
    const water = routes.water.find((r) => r.id === s.id)?.length;
    const f: Partial<Record<FactKind, number>> = {
      power_kw: s.powerKw,
      cycle_s: s.cycleTimeSec,
      busy_pct: Math.round((util[s.type] ?? 0) * 100),
      wall_gap_m: Math.min(s.x, s.y, spec.floor.width - s.x - s.w, spec.floor.depth - s.y - s.d),
      machines_of_this_kind: spec.stations.filter((o) => o.type === s.type).length,
    };
    if (near) f.nearest_gap_m = near.g;
    if (power !== undefined) f.supply_run_m = power;
    if (water !== undefined) f.water_run_m = water;
    machines.set(s.id, f);
  }
  const plant: Partial<Record<FactKind, number>> = {
    connected_kw: spec.stations.reduce((t, s) => t + s.powerKw, 0),
    demand_per_hour: spec.demandPerHour,
    output_per_hour: metrics.sim.unitsPerHour.median,
    floor_width_m: spec.floor.width,
    floor_depth_m: spec.floor.depth,
    machine_count: spec.stations.length,
  };
  if (spec.transport === 'conveyor') plant.conveyor_m = routes.totals.pathM;
  return { plant, machines, nearest };
}

/** A quoted number matches if it is within rounding of the real one: 6%, or 0.15 in absolute terms, or 3 points for a percentage. */
function matches(fact: FactKind, claimed: number, actual: number): boolean {
  if (fact === 'busy_pct') return Math.abs(claimed - actual) <= 3;
  if (fact === 'machines_of_this_kind' || fact === 'machine_count') return Math.round(claimed) === Math.round(actual);
  return Math.abs(claimed - actual) <= Math.max(0.15, Math.abs(actual) * 0.06);
}

export interface CiteCheck {
  /** how many cites were checked and matched */
  checked: number;
  /** one line per cite that does not match the plant */
  wrong: string[];
}

/** Check every number a finding quotes against the plant. An unknown machine or a fact it does not have is wrong too. */
export function checkCites(cites: Cite[], facts: PlantFacts): CiteCheck {
  const wrong: string[] = [];
  let checked = 0;
  for (const c of cites) {
    const isPlant = c.machine.toLowerCase() === 'plant';
    const source = isPlant ? facts.plant : facts.machines.get(c.machine);
    if (!source) {
      wrong.push(`${c.machine} is not a machine on this floor`);
      continue;
    }
    const actual = source[c.fact];
    if (actual === undefined) {
      wrong.push(`${c.machine} has no ${c.fact}`);
      continue;
    }
    if (!Number.isFinite(c.value) || !matches(c.fact, c.value, actual)) {
      wrong.push(`${c.machine} ${c.fact} is ${Math.round(actual * 10) / 10}, not ${c.value}`);
      continue;
    }
    checked++;
  }
  return { checked, wrong };
}

/**
 * A finding that says a unit is missing is wrong if one is already on the floor. Returns the id of the
 * station that already is that unit. Units are matched on what they are, the head noun of the name:
 * "22 kW rotary screw compressor with dryer" is a compressor, "oil-water separator" is a separator.
 * Matching any shared word would call a water-leak test booth an oil-water separator.
 */
export function alreadyOnFloor(spec: FactorySpec, equipmentName: string): string | null {
  const head = (text: string) =>
    text
      .toLowerCase()
      .split(/\b(?:with|for|and|to)\b|[,(/]/)[0]
      .split(/[^a-z]+/)
      .filter((w) => w.length >= 4)
      .pop();
  const want = head(equipmentName);
  if (!want) return null;
  for (const s of spec.stations) {
    if (head(s.name ?? s.type) === want) return s.id;
  }
  return null;
}

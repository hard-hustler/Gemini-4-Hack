import { footprint, snap, type EditOp, type FactorySpec, type Wall } from '../spec';
import { mulberry32 } from './simulate';
import { validate } from './validate';
import { evaluate, type Metrics } from './versions';

/** One scalar to rank layouts by (lower is better, base = 1): lead time, running cost and build cost
 *  relative to a base layout, with a heavy penalty for losing throughput. */
export function objective(base: Metrics, m: Metrics): number {
  const lead = m.sim.leadTimeSec.median / base.sim.leadTimeSec.median;
  const unit = m.cost.costPerUnit / base.cost.costPerUnit;
  const build = m.cost.buildCost / base.cost.buildCost;
  const lost = Math.max(0, 1 - m.sim.unitsPerHour.median / base.sim.unitsPerHour.median);
  return 0.5 * lead + 0.35 * unit + 0.15 * build + 3 * lost;
}

/** Ops that turn `a` into `b`, for layouts that differ only by moves, rotations and dock moves. */
export function opsBetween(a: FactorySpec, b: FactorySpec): EditOp[] {
  const ops: EditOp[] = [];
  for (const s of b.stations) {
    const p = a.stations.find((x) => x.id === s.id);
    if (!p) continue;
    if (p.rot !== s.rot) ops.push({ op: 'rotate', id: s.id, rot: s.rot });
    if (p.x !== s.x || p.y !== s.y) ops.push({ op: 'move', id: s.id, x: s.x, y: s.y });
  }
  b.docks.forEach((d, i) => {
    const p = a.docks[i];
    if (p && (p.wall !== d.wall || p.offset !== d.offset)) ops.push({ op: 'moveDock', index: i, wall: d.wall, offset: d.offset });
  });
  return ops;
}

export interface SearchResult {
  spec: FactorySpec;
  ops: EditOp[];
  /** objective relative to the starting layout (1 = no change, lower is better) */
  score: number;
  tried: number;
  valid: number;
  accepted: number;
}

/**
 * Seeded hill climb over station positions, rotations and dock positions.
 * Every candidate goes through validate(); only valid ones are simulated.
 */
export function localSearch(start: FactorySpec, opts: { iters?: number; seed?: number; simSeeds?: number; moveDocks?: boolean; lockDockWalls?: boolean } = {}): SearchResult {
  const iters = opts.iters ?? 300;
  const simSeeds = opts.simSeeds ?? 6;
  const rnd = mulberry32(opts.seed ?? 1);
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const cell = start.floor.cellSize;
  const baseEv = evaluate(start, simSeeds);
  if (!baseEv.ok) throw new Error('localSearch needs a valid starting layout');
  const base = baseEv.metrics;

  let best = start;
  let bestScore = 1;
  let valid = 0;
  let accepted = 0;

  for (let i = 0; i < iters; i++) {
    const next: FactorySpec = structuredClone(best);
    const roll = rnd();
    if (opts.moveDocks !== false && roll < 0.12 && next.docks.length) {
      const d = pick(next.docks);
      if (!opts.lockDockWalls && rnd() < 0.4) d.wall = pick<Wall>(['N', 'S', 'E', 'W']);
      const len = d.wall === 'N' || d.wall === 'S' ? next.floor.width : next.floor.depth;
      d.offset = snap(1 + rnd() * (len - 2), cell);
    } else {
      const s = pick(next.stations);
      if (roll < 0.2) {
        s.rot = s.rot === 0 ? 90 : 0;
      } else if (roll < 0.6) {
        // nudge
        s.x = snap(s.x + (Math.floor(rnd() * 9) - 4) * cell, cell);
        s.y = snap(s.y + (Math.floor(rnd() * 9) - 4) * cell, cell);
      } else if (roll < 0.85) {
        // jump beside a neighbour in the process flow, leaving a legal aisle
        const k = next.routing.indexOf(s.type);
        const neighbourTypes = [next.routing[k - 1], next.routing[k + 1]].filter(Boolean);
        const others = next.stations.filter((o) => o.id !== s.id && neighbourTypes.includes(o.type));
        if (others.length) {
          const o = footprint(pick(others));
          const f = footprint(s);
          const side = Math.floor(rnd() * 4);
          const gap = 1.5;
          if (side === 0) [s.x, s.y] = [o.x + o.w + gap, o.y];
          else if (side === 1) [s.x, s.y] = [o.x - f.w - gap, o.y];
          else if (side === 2) [s.x, s.y] = [o.x, o.y + o.d + gap];
          else [s.x, s.y] = [o.x, o.y - f.d - gap];
          s.x = snap(s.x, cell);
          s.y = snap(s.y, cell);
        }
      } else {
        // anywhere on the floor
        const f = footprint(s);
        s.x = snap(rnd() * (next.floor.width - f.w), cell);
        s.y = snap(rnd() * (next.floor.depth - f.d), cell);
      }
    }
    if (validate(next).length) continue;
    valid++;
    const ev = evaluate(next, simSeeds);
    if (!ev.ok) continue;
    const score = objective(base, ev.metrics);
    if (score < bestScore - 1e-6) {
      best = next;
      bestScore = score;
      accepted++;
    }
  }
  return { spec: best, ops: opsBetween(start, best), score: bestScore, tried: iters, valid, accepted };
}

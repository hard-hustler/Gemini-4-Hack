import { centre, footprint, inboundDock, outboundDock, type FactorySpec, type Rect } from '../spec';
import { accessCells, buildGrid, dockCell, flood, idx } from './grid';

export interface ValidationError {
  code:
    | 'floor'
    | 'out_of_bounds'
    | 'overlap'
    | 'aisle'
    | 'dock'
    | 'unreachable'
    | 'power'
    | 'water'
    | 'routing'
    | 'param';
  message: string;
  /** station ids (or dock:N) the error is about, so the UI and the model can target them */
  ids: string[];
}

export const MIN_AISLE_M = 1.2;
export const MAX_UTILITY_RUN_M = 60;
const EPS = 1e-6;

export function gapBetween(a: Rect, b: Rect): { gap: number; facing: boolean; overlap: boolean } {
  const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const dy = Math.max(b.y - (a.y + a.d), a.y - (b.y + b.d));
  if (dx < -EPS && dy < -EPS) return { gap: 0, facing: true, overlap: true };
  // "facing" means they share a span on one axis, so the gap between them is a corridor
  if (dx >= -EPS && dy < -EPS) return { gap: Math.max(0, dx), facing: true, overlap: false };
  if (dy >= -EPS && dx < -EPS) return { gap: Math.max(0, dy), facing: true, overlap: false };
  return { gap: Math.hypot(Math.max(0, dx), Math.max(0, dy)), facing: false, overlap: false };
}

/** Deterministic layout checks. Returns specific, addressable errors; an empty list means valid. */
export function validate(spec: FactorySpec): ValidationError[] {
  const errors: ValidationError[] = [];
  const { width, depth, cellSize } = spec.floor;
  if (!(width > 0 && depth > 0 && cellSize > 0)) {
    return [{ code: 'floor', message: 'Floor width, depth and cellSize must be positive', ids: [] }];
  }

  const ids = new Set<string>();
  for (const s of spec.stations) {
    if (ids.has(s.id)) errors.push({ code: 'param', message: `Duplicate station id "${s.id}"`, ids: [s.id] });
    ids.add(s.id);
    if (!(s.w > 0 && s.d > 0)) errors.push({ code: 'param', message: `${s.id}: width and depth must be positive`, ids: [s.id] });
    if (!(s.cycleTimeSec > 0)) errors.push({ code: 'param', message: `${s.id}: cycleTimeSec must be positive`, ids: [s.id] });
    const f = footprint(s);
    if (f.x < -EPS || f.y < -EPS || f.x + f.w > width + EPS || f.y + f.d > depth + EPS) {
      errors.push({
        code: 'out_of_bounds',
        message: `${s.id} (${f.w}x${f.d} m at ${f.x},${f.y}) extends outside the ${width}x${depth} m floor`,
        ids: [s.id],
      });
    }
  }

  for (let i = 0; i < spec.stations.length; i++) {
    for (let j = i + 1; j < spec.stations.length; j++) {
      const a = spec.stations[i];
      const b = spec.stations[j];
      const { gap, facing, overlap } = gapBetween(footprint(a), footprint(b));
      if (overlap) {
        errors.push({ code: 'overlap', message: `${a.id} overlaps ${b.id}`, ids: [a.id, b.id] });
      } else if (facing && gap > EPS && gap < MIN_AISLE_M - EPS) {
        errors.push({
          code: 'aisle',
          message: `Aisle between ${a.id} and ${b.id} is ${gap.toFixed(2)} m; minimum is ${MIN_AISLE_M} m (or place them flush)`,
          ids: [a.id, b.id],
        });
      }
    }
  }

  if (spec.docks.length === 0) {
    errors.push({ code: 'dock', message: 'At least one dock is required', ids: [] });
  }
  spec.docks.forEach((d, i) => {
    const len = d.wall === 'N' || d.wall === 'S' ? width : depth;
    if (!['N', 'S', 'E', 'W'].includes(d.wall)) {
      errors.push({ code: 'dock', message: `Dock ${i} must be on an outside wall (N, S, E or W)`, ids: [`dock:${i}`] });
    } else if (!(d.offset >= 0 && d.offset <= len)) {
      errors.push({
        code: 'dock',
        message: `Dock ${i} offset ${d.offset} m is off the ${d.wall} wall (length ${len} m)`,
        ids: [`dock:${i}`],
      });
    }
  });

  for (const type of spec.routing) {
    if (!spec.stations.some((s) => s.type === type)) {
      errors.push({ code: 'routing', message: `Routing needs a "${type}" station but none exists`, ids: [] });
    }
  }
  if (spec.routing.length === 0) errors.push({ code: 'routing', message: 'Routing is empty', ids: [] });

  // Geometry is broken: reachability on the grid would only add noise.
  if (errors.some((e) => ['out_of_bounds', 'overlap', 'dock', 'param'].includes(e.code))) return errors;

  const grid = buildGrid(spec);
  const inDock = inboundDock(spec)!;
  const start = dockCell(spec, grid, inDock);
  const reached = flood(grid, start);
  spec.docks.forEach((d, i) => {
    const c = dockCell(spec, grid, d);
    if (!reached[idx(grid, c.c, c.r)]) {
      errors.push({
        code: 'unreachable',
        message: i === spec.docks.indexOf(inDock) ? `Dock ${i} is blocked by a station` : `Dock ${i} cannot be reached from the inbound dock`,
        ids: [`dock:${i}`],
      });
    }
  });
  void outboundDock;
  spec.stations.forEach((s, i) => {
    const ok = accessCells(grid, i).some((c) => reached[idx(grid, c.c, c.r)]);
    if (!ok) {
      errors.push({ code: 'unreachable', message: `${s.id} cannot be reached by forklift from the inbound dock`, ids: [s.id] });
    }
  });

  const inside = (p: { x: number; y: number }) => p.x >= -EPS && p.y >= -EPS && p.x <= width + EPS && p.y <= depth + EPS;
  const { power, water } = spec.utilityEntry;
  if (!inside(power)) errors.push({ code: 'power', message: 'Power entry point is outside the floor', ids: [] });
  if (!inside(water)) errors.push({ code: 'water', message: 'Water entry point is outside the floor', ids: [] });
  for (const s of spec.stations) {
    const c = centre(s);
    const pRun = Math.abs(c.x - power.x) + Math.abs(c.y - power.y);
    const wRun = Math.abs(c.x - water.x) + Math.abs(c.y - water.y);
    if (s.powerKw > 0 && pRun > MAX_UTILITY_RUN_M) {
      errors.push({ code: 'power', message: `${s.id} is ${pRun.toFixed(1)} m from the power entry; max run is ${MAX_UTILITY_RUN_M} m`, ids: [s.id] });
    }
    if (s.needsWater && wRun > MAX_UTILITY_RUN_M) {
      errors.push({ code: 'water', message: `${s.id} is ${wRun.toFixed(1)} m from the water entry; max run is ${MAX_UTILITY_RUN_M} m`, ids: [s.id] });
    }
  }
  return errors;
}

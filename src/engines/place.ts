// Deterministic placer: Requirements + bill of equipment -> a valid FactorySpec.
// Models decide WHAT goes on the floor; this decides WHERE. No model call can produce
// an invalid layout because no model produces coordinates.

import type { EquipmentLine, Requirements } from '../contracts';
import { dockPoint, footprint, snap, type FactorySpec, type Point, type Rect, type Station, type Wall } from '../spec';
import { buildGrid, isFree, pointToCell } from './grid';
import { route } from './route';
import { localSearch } from './search';
import { mulberry32 } from './simulate';
import { gapBetween, MIN_AISLE_M, validate, type ValidationError } from './validate';

/** Grid step. Half a metre in a workshop; a metre on a plant floor, so 100+ stations stay quick to place and route. */
let CELL = 0.5;
const LARGE_FLOOR_M = 60;
const LARGE_STATIONS = 40;
const EPS = 1e-6;
export const DEFAULT_COSTS: FactorySpec['costs'] = { labourPerHour: 28, electricityPerKwh: 0.16, powerRunPerM: 45, waterRunPerM: 70 };

export class PlaceError extends Error {
  constructor(
    message: string,
    public errors: ValidationError[] = [],
  ) {
    super(message);
  }
}

export interface PlaceResult {
  spec: FactorySpec;
  method: 'as drawn' | 'flow line';
  polished: boolean;
  /** objective after polish relative to the first valid layout (1 = unchanged, lower is better) */
  polishScore: number;
  variantsTried: number;
}

function stationsFrom(req: Requirements, equipment: EquipmentLine[]): Station[] {
  const out: Station[] = [];
  for (const step of req.steps) {
    const line = equipment.find((l) => l.stepType === step.type);
    if (!line || line.qty < 1) continue;
    for (let k = 1; k <= line.qty; k++) {
      const it = line.item;
      out.push({
        id: `${step.type}${k}`,
        type: step.type,
        x: 0,
        y: 0,
        w: Math.max(CELL, snap(it.footprint.w, CELL)),
        d: Math.max(CELL, snap(it.footprint.d, CELL)),
        rot: 0,
        cycleTimeSec: Math.max(1, it.cycleTimeSec),
        operators: it.operators,
        powerKw: it.powerKw,
        needsWater: it.needsWater,
        price: it.price,
        zone: step.zone,
        name: it.name,
        catalogId: it.id,
        height: it.recipe?.size.h ?? it.footprint.h,
        shape: it.shape,
        recipe: it.recipe,
        modelUrl: it.modelUrl,
        image: it.listing?.image,
        listingUrl: it.listing?.url,
        checkoutUrl: it.listing?.checkoutUrl,
      });
    }
  }
  return out;
}

const wallLen = (spec: FactorySpec, w: Wall) => (w === 'N' || w === 'S' ? spec.floor.width : spec.floor.depth);
const wallPoint = (spec: FactorySpec, wall: Wall, offset: number): Point => dockPoint(spec, { wall, offset });

function clear(r: Rect, placed: Rect[], width: number, depth: number): boolean {
  if (r.x < -EPS || r.y < -EPS || r.x + r.w > width + EPS || r.y + r.d > depth + EPS) return false;
  for (const p of placed) {
    const { gap, facing, overlap } = gapBetween(r, p);
    if (overlap) return false;
    if (facing && gap > EPS && gap < MIN_AISLE_M - EPS) return false;
  }
  return true;
}

const spirals = new Map<number, [number, number][]>();
/** Grid offsets out to `reach` cells, nearest first. */
function spiral(reach: number): [number, number][] {
  let offsets = spirals.get(reach);
  if (!offsets) {
    offsets = [];
    for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) offsets.push([dx, dy]);
    offsets.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
    spirals.set(reach, offsets);
  }
  return offsets;
}

/** Move each station to the nearest spot to where it wants to be that is legal against those already placed. */
function legalise(stations: Station[], want: Point[], width: number, depth: number): Station[] | null {
  const reach = Math.min(48, Math.ceil(Math.max(width, depth) / CELL));
  const offsets = spiral(reach);
  const placed: Rect[] = [];
  const out: Station[] = [];
  for (let i = 0; i < stations.length; i++) {
    const s = { ...stations[i] };
    const bx = snap(want[i].x, CELL);
    const by = snap(want[i].y, CELL);
    let ok = false;
    for (const [dx, dy] of offsets) {
      s.x = bx + dx * CELL;
      s.y = by + dy * CELL;
      if (clear(footprint(s), placed, width, depth)) {
        ok = true;
        break;
      }
    }
    if (!ok) return null;
    placed.push(footprint(s));
    out.push(s);
  }
  return out;
}

interface RowStyle {
  margin: number;
  /** gap between neighbouring stations of different types */
  gap: number;
  aisle: number;
  /** stations of the same type stand flush, as one bank */
  bank: boolean;
  /** rows stand back to back in pairs, sharing no aisle between the two */
  paired: boolean;
  /** fill each row before starting the next, instead of splitting evenly */
  greedy: boolean;
  /** widen gaps and aisles to use the floor, up to these limits (plants) */
  spread?: { gap: number; aisle: number };
}

/** Stations in process order along a serpentine: row one runs one way, row two comes back (a U for two rows). */
function serpentine(stations: Station[], width: number, depth: number, st: RowStyle): Point[] | null {
  // gaps and aisles are rounded up to the grid, so snapping can never shrink one below the minimum
  const up = (v: number) => (v > 0 ? Math.ceil(v / CELL - EPS) * CELL : 0);
  st = { ...st, margin: up(st.margin), gap: up(st.gap), aisle: up(st.aisle) };
  const usable = width - 2 * st.margin;
  const gapAfter = (row: Station[], i: number) => (i === row.length - 1 ? 0 : st.bank && row[i].type === row[i + 1].type ? 0 : st.gap);
  const rowW = (row: Station[]) => row.reduce((t, s, i) => t + s.w + gapAfter(row, i), 0);
  if (stations.some((s) => s.w > usable + EPS)) return null;

  // greedy fill gives the fewest rows; an even split then avoids a stub last row
  const greedyRows: Station[][] = [[]];
  for (const s of stations) {
    const row = greedyRows[greedyRows.length - 1];
    if (row.length && rowW([...row, s]) > usable + EPS) greedyRows.push([s]);
    else row.push(s);
  }
  let groups = greedyRows;
  if (!st.greedy) {
    const perRow = Math.ceil(stations.length / greedyRows.length);
    const even: Station[][] = [];
    for (let r = 0; r * perRow < stations.length; r++) even.push(stations.slice(r * perRow, (r + 1) * perRow));
    if (even.every((g) => rowW(g) <= usable + EPS)) groups = even;
  }

  const rowD = (row: Station[]) => Math.max(...row.map((s) => s.d));
  // paired: wall row, aisle, then rows back to back in twos
  const aisleAfter = (r: number) => (r === groups.length - 1 ? 0 : st.paired && r % 2 === 1 ? 0 : st.aisle);
  let blockD = groups.reduce((t, g, r) => t + rowD(g) + aisleAfter(r), 0);
  if (blockD > depth - 2 * st.margin + EPS) return null;
  // centre the block on the floor so the rows read as one line with clear aisles all round
  // spreading: share spare floor between the aisles and between the stations of each row
  const down = (v: number) => Math.max(0, Math.floor(v / CELL + EPS) * CELL);
  const aisles = groups.filter((_, r) => aisleAfter(r) > 0).length;
  const moreAisle = st.spread && aisles ? down(Math.min(st.spread.aisle - st.aisle, (depth - 2 * st.margin - blockD) / aisles)) : 0;
  blockD += moreAisle * aisles;
  let y = st.margin + Math.floor((depth - 2 * st.margin - blockD) / 2 / CELL) * CELL;
  const out: Point[] = [];
  groups.forEach((row, r) => {
    const joins = row.filter((_, i) => gapAfter(row, i) > 0).length;
    const moreGap = st.spread && joins ? down(Math.min(st.spread.gap - st.gap, (usable - rowW(row)) / joins)) : 0;
    const wide = rowW(row) + moreGap * joins;
    let cx = st.margin + Math.floor((usable - wide) / 2 / CELL) * CELL;
    const xs = row.map((s, i) => {
      const at = cx;
      cx += s.w + gapAfter(row, i) + (gapAfter(row, i) > 0 ? moreGap : 0);
      return at;
    });
    row.forEach((s, i) => out.push({ x: r % 2 === 0 ? xs[i] : width - xs[i] - s.w, y }));
    y += rowD(row) + aisleAfter(r) + (aisleAfter(r) > 0 ? moreAisle : 0);
  });
  return out;
}

/** Put a dock on its wall as close as possible to a target point, on a free cell. */
function dockOffset(spec: FactorySpec, wall: Wall, target: Point): number {
  const grid = buildGrid(spec);
  const len = wallLen(spec, wall);
  const along = wall === 'N' || wall === 'S' ? target.x : target.y;
  const options: number[] = [];
  for (let o = 1; o <= len - 1 + EPS; o += CELL) options.push(o);
  options.sort((a, b) => Math.abs(a - along) - Math.abs(b - along));
  for (const o of options) {
    const c = pointToCell(grid, wallPoint(spec, wall, o));
    if (isFree(grid, c.c, c.r)) return o;
  }
  return snap(len / 2, CELL);
}

function finish(base: FactorySpec, stations: Station[], req: Requirements): FactorySpec {
  const spec: FactorySpec = { ...base, stations };
  const mid = (s: Station): Point => ({ x: s.x + footprint(s).w / 2, y: s.y + footprint(s).d / 2 });
  const first = stations.find((s) => s.type === spec.routing[0]) ?? stations[0];
  const last = [...stations].reverse().find((s) => s.type === spec.routing[spec.routing.length - 1]) ?? stations[stations.length - 1];
  const inOff = dockOffset(spec, req.dockIn, mid(first));
  let outOff = dockOffset(spec, req.dockOut, mid(last));
  if (req.dockIn === req.dockOut && Math.abs(inOff - outOff) < 3) {
    // keep two docks on one wall from sitting on top of each other
    const len = wallLen(spec, req.dockOut);
    outOff = snap(inOff + 3 <= len - 1 ? inOff + 3 : Math.max(1, inOff - 3), CELL);
  }
  spec.docks = [
    { wall: req.dockIn, offset: inOff, kind: 'in' },
    { wall: req.dockOut, offset: outOff, kind: 'out' },
  ];
  const centroid = (list: Station[]): Point =>
    list.length ? { x: list.reduce((t, s) => t + mid(s).x, 0) / list.length, y: list.reduce((t, s) => t + mid(s).y, 0) / list.length } : { x: spec.floor.width / 2, y: spec.floor.depth / 2 };
  const entry = (wall: Wall, users: Station[]) => {
    const c = centroid(users);
    const len = wallLen(spec, wall);
    return wallPoint(spec, wall, Math.min(len, Math.max(0, snap(wall === 'N' || wall === 'S' ? c.x : c.y, CELL))));
  };
  spec.utilityEntry = { power: entry(req.powerWall, stations.filter((s) => s.powerKw > 0)), water: entry(req.waterWall, stations.filter((s) => s.needsWater)) };
  return spec;
}

/** Requirements + equipment -> a validated layout, or a PlaceError that says exactly why not. */
export function buildLayout(req: Requirements, equipment: EquipmentLine[], opts: { polish?: boolean } = {}): PlaceResult {
  const count = equipment.reduce((t, l) => t + Math.max(0, l.qty), 0);
  const large = Math.max(req.floor.width, req.floor.depth) > LARGE_FLOOR_M || count > LARGE_STATIONS;
  CELL = large ? 1 : 0.5;
  const width = Math.max(4, snap(req.floor.width, CELL));
  const depth = Math.max(4, snap(req.floor.depth, CELL));
  const stations = stationsFrom(req, equipment);
  if (!stations.length) throw new PlaceError('There is no equipment to place');
  const present = new Set(stations.map((s) => s.type));
  const base: FactorySpec = {
    name: req.name,
    floor: { width, depth, cellSize: CELL },
    docks: [],
    utilityEntry: { power: { x: 0, y: 0 }, water: { x: 0, y: 0 } },
    stations: [],
    routing: req.steps.map((s) => s.type).filter((t, i, a) => present.has(t) && a.indexOf(t) === i),
    demandPerHour: Math.max(1, req.demandPerHour),
    forklifts: 1,
    transport: req.transport ?? (large ? 'conveyor' : 'forklift'),
    costs: DEFAULT_COSTS,
  };

  const area = stations.reduce((t, s) => t + s.w * s.d, 0);
  if (area > width * depth * 0.6) {
    throw new PlaceError(`Equipment covers ${area.toFixed(0)} m² of a ${(width * depth).toFixed(0)} m² floor; there is no room left for aisles`);
  }

  // How far a unit travels. Routed exactly on a workshop floor; on a plant, the straight-line
  // distance between each step's centre and the next is a close and far cheaper stand-in.
  const tourLength = (spec: FactorySpec): number => {
    if (!large) return route(spec).totals.forkliftM;
    const centreOf = (type: string) => {
      const list = spec.stations.filter((s) => s.type === type);
      return { x: list.reduce((t, s) => t + s.x + footprint(s).w / 2, 0) / list.length, y: list.reduce((t, s) => t + s.y + footprint(s).d / 2, 0) / list.length };
    };
    const stops = [dockPoint(spec, spec.docks[0]), ...spec.routing.map(centreOf), dockPoint(spec, spec.docks[1] ?? spec.docks[0])];
    let len = 0;
    for (let i = 1; i < stops.length; i++) len += Math.abs(stops[i].x - stops[i - 1].x) + Math.abs(stops[i].y - stops[i - 1].y);
    return len;
  };

  let best: { spec: FactorySpec; len: number } | null = null;
  let lastErrors: ValidationError[] = [];
  let tried = 0;
  const consider = (want: Point[] | null) => {
    if (!want) return;
    tried++;
    const legal = legalise(stations, want, width, depth);
    if (!legal) return;
    const spec = finish(base, legal, req);
    const errs = validate(spec);
    if (errs.length) {
      lastErrors = errs;
      return;
    }
    const len = tourLength(spec);
    if (!best || len < best.len) best = { spec, len };
  };

  const considerTurned = (want: Point[]) => {
    tried++;
    const legal = legalise(
      stations.map((s) => ({ ...s, rot: 90 as const })),
      want,
      width,
      depth,
    );
    if (!legal) return;
    const spec = finish(base, legal, req);
    const errs = validate(spec);
    if (errs.length) {
      lastErrors = errs;
      return;
    }
    const len = tourLength(spec);
    if (!best || len < best.len) best = { spec, len };
  };

  // 1. A drawing wins: put things where they were drawn, nudged only as far as legality requires.
  const drawn = req.sketch.length >= Math.ceil(stations.length / 2);
  if (drawn) {
    const used = new Map<string, number>();
    consider(
      stations.map((s) => {
        const k = used.get(s.type) ?? 0;
        used.set(s.type, k + 1);
        const hints = req.sketch.filter((h) => h.type === s.type);
        const h = hints[k] ?? hints[hints.length - 1] ?? { fx: 0.5, fy: 0.5 };
        return { x: h.fx * width - s.w / 2, y: h.fy * depth - s.d / 2 };
      }),
    );
    if (best) return { spec: (best as { spec: FactorySpec }).spec, method: 'as drawn', polished: false, polishScore: 1, variantsTried: tried };
  }

  // 2. Otherwise a flow line: serpentine variants from roomy to tight, mirrored four ways, each also
  //    tried turned a quarter (rows running north-south). The shortest forklift tour of the first
  //    style that fits wins.
  const styles: RowStyle[] = [
    // a plant gets wide conveyor aisles before anything tighter is tried
    ...(large
      ? [
          { margin: 8, gap: 5, aisle: 12, bank: false, paired: false, greedy: false, spread: { gap: 10, aisle: 18 } },
          { margin: 6, gap: 4, aisle: 9, bank: false, paired: false, greedy: false, spread: { gap: 8, aisle: 14 } },
          { margin: 4, gap: 3, aisle: 6, bank: false, paired: false, greedy: false },
          { margin: 3, gap: 2, aisle: 4, bank: true, paired: false, greedy: false },
        ]
      : []),
    // a conveyor line on a mid-size floor: room for the belts, then spread over the floor it was given
    ...(!large && req.transport === 'conveyor'
      ? [
          { margin: 2.5, gap: 2, aisle: 3.5, bank: false, paired: false, greedy: false, spread: { gap: Math.max(4, width * 0.12), aisle: Math.max(6, depth * 0.3) } },
          { margin: 2, gap: 1.5, aisle: 3, bank: false, paired: false, greedy: false, spread: { gap: Math.max(3, width * 0.09), aisle: Math.max(5, depth * 0.24) } },
        ]
      : []),
    { margin: 1.5, gap: 1.5, aisle: 2.5, bank: false, paired: false, greedy: false },
    { margin: 1.5, gap: 1.5, aisle: 2, bank: false, paired: false, greedy: false },
    { margin: 1, gap: 1.5, aisle: 1.5, bank: false, paired: false, greedy: false },
    { margin: 1, gap: 1.2, aisle: 1.2, bank: true, paired: false, greedy: false },
    { margin: 0.5, gap: 1.2, aisle: 1.2, bank: true, paired: false, greedy: true },
    { margin: 0, gap: 1.2, aisle: 1.2, bank: true, paired: false, greedy: true },
    { margin: 0, gap: 1.2, aisle: 1.2, bank: true, paired: true, greedy: true },
    { margin: 0, gap: 0, aisle: 1.2, bank: true, paired: false, greedy: true },
    { margin: 0, gap: 0, aisle: 1.2, bank: true, paired: true, greedy: true },
  ];
  for (const style of styles) {
    const flat = serpentine(stations, width, depth, style);
    // rows running north-south: lay the same stations out on the transposed floor, then turn each a quarter
    const quarter = serpentine(stations, depth, width, style);
    for (const fx of [false, true])
      for (const fy of [false, true]) {
        if (flat) consider(flat.map((p, i) => ({ x: fx ? width - p.x - stations[i].w : p.x, y: fy ? depth - p.y - stations[i].d : p.y })));
        if (quarter) {
          // transpose back: the turned layout's x is our y
          considerTurned(quarter.map((p, i) => ({ x: fx ? width - p.y - stations[i].d : p.y, y: fy ? depth - p.x - stations[i].w : p.x })));
        }
      }
    if (best) break;
  }

  // 3. Last resort: seeded random starting points, legalised.
  if (!best) {
    const rnd = mulberry32(11);
    for (let k = 0; k < 150 && !best; k++) consider(stations.map((s) => ({ x: rnd() * (width - s.w), y: rnd() * (depth - s.d) })));
  }
  if (!best) {
    throw new PlaceError(
      lastErrors.length ? 'Could not find a legal layout for this equipment on this floor' : `Could not fit ${stations.length} stations on a ${width} x ${depth} m floor with ${MIN_AISLE_M} m aisles`,
      lastErrors,
    );
  }
  const start = (best as { spec: FactorySpec }).spec;
  if (opts.polish === false || large) return { spec: start, method: 'flow line', polished: false, polishScore: 1, variantsTried: tried };

  // 4. Polish with the seeded search; dock walls stay where the brief put them.
  let polished = start;
  let score = 1;
  for (const seed of [1, 2, 3]) {
    const r = localSearch(start, { iters: 220, seed, lockDockWalls: true });
    if (r.score < score) {
      score = r.score;
      polished = r.spec;
    }
  }
  return { spec: polished, method: 'flow line', polished: score < 1, polishScore: score, variantsTried: tried };
}

/**
 * One more station like `id`, placed at the nearest legal spot to the original.
 * This is how capacity is added: a model asks for a clone, code decides where it goes.
 * Returns null when the floor has no legal spot within reach.
 */
export function cloneStation(spec: FactorySpec, id: string): Station | null {
  const source = spec.stations.find((s) => s.id === id);
  if (!source) return null;
  const cell = spec.floor.cellSize;
  let n = spec.stations.filter((s) => s.type === source.type).length + 1;
  while (spec.stations.some((s) => s.id === `${source.type}${n}`)) n++;
  const placed = spec.stations.map(footprint);
  const copy: Station = { ...source, id: `${source.type}${n}` };
  let tries = 0;
  for (const [dx, dy] of spiral(Math.min(40, Math.ceil(Math.max(spec.floor.width, spec.floor.depth) / cell)))) {
    if (!dx && !dy) continue;
    copy.x = source.x + dx * cell;
    copy.y = source.y + dy * cell;
    if (!clear(footprint(copy), placed, spec.floor.width, spec.floor.depth)) continue;
    // the cheap geometry test passed; the full rules (reachability, docks) get the last word
    if (!validate({ ...spec, stations: [...spec.stations, copy] }).length) return { ...copy };
    if (++tries > 24) break;
  }
  return null;
}

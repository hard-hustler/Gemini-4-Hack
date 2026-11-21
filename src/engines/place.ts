// Deterministic placer: Requirements + bill of equipment -> a valid FactorySpec.
// Models decide WHAT goes on the floor; this decides WHERE. No model call can produce
// an invalid layout because no model produces coordinates.

import type { EquipmentLine, Requirements } from '../contracts';
import { dockPoint, footprint, snap, type FactorySpec, type Point, type Rect, type Station, type Wall } from '../spec';
import { buildGrid, isFree, pointToCell } from './grid';
import { route } from './route';
import { localSearch } from './search';
import { gapBetween, MIN_AISLE_M, validate, type ValidationError } from './validate';

const CELL = 0.5;
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
        name: it.name,
        catalogId: it.id,
        height: it.footprint.h,
        shape: it.shape,
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

/** Move each station to the nearest spot to where it wants to be that is legal against those already placed. */
function legalise(stations: Station[], want: Point[], width: number, depth: number): Station[] | null {
  const reach = Math.ceil(Math.max(width, depth) / CELL);
  const offsets: [number, number][] = [];
  for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) offsets.push([dx, dy]);
  offsets.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
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

/** Stations in process order along a serpentine: row one runs one way, row two comes back (a U for two rows). */
function serpentine(stations: Station[], width: number, depth: number, margin: number, gap: number, aisle: number): Point[] | null {
  const usable = width - 2 * margin;
  // greedy row count, then split evenly so the last row is not a stub
  let rows = 1;
  let x = 0;
  for (const s of stations) {
    if (s.w > usable + EPS) return null;
    if (x > 0 && x + s.w > usable + EPS) {
      rows++;
      x = 0;
    }
    x += s.w + gap;
  }
  const perRow = Math.ceil(stations.length / rows);
  const out: Point[] = [];
  let y = margin;
  for (let r = 0; r * perRow < stations.length; r++) {
    const row = stations.slice(r * perRow, (r + 1) * perRow);
    const rowW = row.reduce((t, s) => t + s.w, 0) + gap * (row.length - 1);
    if (rowW > usable + EPS) return null;
    const rowD = Math.max(...row.map((s) => s.d));
    if (y + rowD > depth - margin + EPS) return null;
    let cx = margin;
    const xs = row.map((s) => {
      const at = cx;
      cx += s.w + gap;
      return at;
    });
    row.forEach((s, i) => out.push({ x: r % 2 === 0 ? xs[i] : width - xs[i] - s.w, y }));
    y += rowD + aisle;
  }
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
    costs: DEFAULT_COSTS,
  };

  const area = stations.reduce((t, s) => t + s.w * s.d, 0);
  if (area > width * depth * 0.6) {
    throw new PlaceError(`Equipment covers ${area.toFixed(0)} m² of a ${(width * depth).toFixed(0)} m² floor; there is no room left for aisles`);
  }

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
    const len = route(spec).totals.forkliftM;
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

  // 2. Otherwise a flow line: serpentine variants, mirrored four ways, shortest forklift tour wins.
  for (const [margin, gap, aisle] of [
    [1.5, 1.5, 2.5],
    [1.5, 1.5, 2],
    [1, 1.5, 1.5],
    [1, 1.2, 1.2],
    [0.5, 1.2, 1.2],
  ] as const) {
    const want = serpentine(stations, width, depth, margin, gap, aisle);
    if (!want) continue;
    for (const fx of [false, true])
      for (const fy of [false, true])
        consider(want.map((p, i) => ({ x: fx ? width - p.x - stations[i].w : p.x, y: fy ? depth - p.y - stations[i].d : p.y })));
    if (best) break;
  }
  if (!best) {
    throw new PlaceError(
      lastErrors.length ? 'Could not find a legal layout for this equipment on this floor' : `Could not fit ${stations.length} stations on a ${width} x ${depth} m floor with ${MIN_AISLE_M} m aisles`,
      lastErrors,
    );
  }
  const start = (best as { spec: FactorySpec }).spec;
  if (opts.polish === false) return { spec: start, method: 'flow line', polished: false, polishScore: 1, variantsTried: tried };

  // 3. Polish with the seeded search; dock walls stay where the brief put them.
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

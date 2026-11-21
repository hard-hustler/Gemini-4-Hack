import type { MachineRecipe } from './machines';

// FactorySpec: the single source of truth. Models emit a spec or edit ops, never layout prose.
// Units: metres, seconds, kW. Origin is the north-west corner; x runs east, y runs south.

export type Wall = 'N' | 'S' | 'E' | 'W';
export type Rot = 0 | 90 | 180 | 270;

export interface Dock {
  wall: Wall;
  /** metres along the wall, from the west end (N/S walls) or north end (E/W walls) */
  offset: number;
  /** docks[0] is inbound and docks[1] outbound unless kind says otherwise */
  kind?: 'in' | 'out';
}

export interface Point {
  x: number;
  y: number;
}

export interface Station {
  id: string;
  type: string;
  /** north-west corner of the footprint */
  x: number;
  y: number;
  w: number;
  d: number;
  rot: Rot;
  cycleTimeSec: number;
  operators: number;
  powerKw: number;
  needsWater: boolean;
  price: number;
  /** display and catalog fields: ignored by the engines */
  name?: string;
  catalogId?: string;
  height?: number;
  shape?: 'bench' | 'rack' | 'machine' | 'table' | 'conveyor';
  recipe?: MachineRecipe;
  modelUrl?: string;
  image?: string;
  listingUrl?: string;
  checkoutUrl?: string;
}

export interface FactorySpec {
  name?: string;
  floor: { width: number; depth: number; cellSize: number };
  docks: Dock[];
  utilityEntry: { power: Point; water: Point };
  stations: Station[];
  /** ordered station types a product visits */
  routing: string[];
  demandPerHour: number;
  forklifts?: number;
  costs: {
    labourPerHour: number;
    electricityPerKwh: number;
    powerRunPerM: number;
    waterRunPerM: number;
  };
}

export type EditOp =
  | { op: 'move'; id: string; x: number; y: number }
  | { op: 'rotate'; id: string; rot: Rot }
  | { op: 'add'; station: Station }
  | { op: 'remove'; id: string }
  | { op: 'moveDock'; index: number; wall: Wall; offset: number }
  | { op: 'setParam'; path: string; value: number | string | boolean };

export interface Rect {
  x: number;
  y: number;
  w: number;
  d: number;
}

/** Footprint after rotation: 90 and 270 swap width and depth. */
export function footprint(s: Station): Rect {
  const swap = s.rot === 90 || s.rot === 270;
  return { x: s.x, y: s.y, w: swap ? s.d : s.w, d: swap ? s.w : s.d };
}

export function centre(s: Station): Point {
  const f = footprint(s);
  return { x: f.x + f.w / 2, y: f.y + f.d / 2 };
}

export function dockPoint(spec: FactorySpec, dock: Dock): Point {
  const { width, depth } = spec.floor;
  switch (dock.wall) {
    case 'N':
      return { x: dock.offset, y: 0 };
    case 'S':
      return { x: dock.offset, y: depth };
    case 'W':
      return { x: 0, y: dock.offset };
    case 'E':
      return { x: width, y: dock.offset };
  }
}

export function inboundDock(spec: FactorySpec): Dock | undefined {
  return spec.docks.find((d) => d.kind === 'in') ?? spec.docks[0];
}

export function outboundDock(spec: FactorySpec): Dock | undefined {
  return spec.docks.find((d) => d.kind === 'out') ?? spec.docks[1] ?? spec.docks[0];
}

export function snap(v: number, cell: number): number {
  return Math.round(v / cell) * cell;
}

/** Pure: returns a new spec. Throws on an op that cannot be applied at all (unknown id, bad path). */
export function applyOp(spec: FactorySpec, op: EditOp): FactorySpec {
  const next: FactorySpec = structuredClone(spec);
  const find = (id: string) => {
    const s = next.stations.find((st) => st.id === id);
    if (!s) throw new Error(`No station with id "${id}"`);
    return s;
  };
  switch (op.op) {
    case 'move': {
      const s = find(op.id);
      s.x = op.x;
      s.y = op.y;
      break;
    }
    case 'rotate':
      find(op.id).rot = op.rot;
      break;
    case 'add':
      if (next.stations.some((s) => s.id === op.station.id)) {
        throw new Error(`Station id "${op.station.id}" already exists`);
      }
      next.stations.push(op.station);
      break;
    case 'remove':
      find(op.id);
      next.stations = next.stations.filter((s) => s.id !== op.id);
      break;
    case 'moveDock': {
      const d = next.docks[op.index];
      if (!d) throw new Error(`No dock at index ${op.index}`);
      d.wall = op.wall;
      d.offset = op.offset;
      break;
    }
    case 'setParam': {
      // path examples: "demandPerHour", "costs.labourPerHour", "stations.asm1.cycleTimeSec"
      const parts = op.path.split('.');
      let target: any = next;
      if (parts[0] === 'stations' && parts.length === 3) {
        target = find(parts[1]);
        parts.splice(0, 2);
      }
      while (parts.length > 1) {
        target = target?.[parts.shift()!];
      }
      if (target === undefined || target === null || !(parts[0] in target)) {
        throw new Error(`Unknown param path "${op.path}"`);
      }
      target[parts[0]] = op.value;
      break;
    }
  }
  return next;
}

export function applyOps(spec: FactorySpec, ops: EditOp[]): FactorySpec {
  return ops.reduce(applyOp, spec);
}

/** The spec without display fields: what a model needs to reason about a layout, and nothing else. */
export function leanSpec(spec: FactorySpec): FactorySpec {
  return {
    ...spec,
    stations: spec.stations.map(({ name: _n, catalogId: _c, height: _h, shape: _s, recipe: _r, modelUrl: _m, image: _i, listingUrl: _l, checkoutUrl: _k, ...s }) => s),
  };
}

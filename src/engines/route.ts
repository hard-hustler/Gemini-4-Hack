import { centre, dockPoint, inboundDock, outboundDock, type FactorySpec, type Point } from '../spec';
import { accessCells, astar, beltLength, buildGrid, cellCentre, dockCell, layBelt, trunkPath, type Cell, type Grid } from './grid';

export interface ForkliftPath {
  from: string;
  to: string;
  /** index of the leg in the product flow: 0 = inbound dock to first stage */
  leg: number;
  points: Point[];
  length: number;
}

export interface UtilityRun {
  id: string;
  points: Point[];
  length: number;
}

export interface Routes {
  forklift: ForkliftPath[];
  /** mean path length per leg (metres); legs.length === routing.length + 1 */
  legLengths: number[];
  /** from/to pairs with no path: only possible on a spec that fails validate() */
  missing: { from: string; to: string }[];
  power: UtilityRun[];
  water: UtilityRun[];
  /** forkliftM is the mean distance one unit travels; pathM is the length of every drawn path, or with conveyors the metres of belt (shared stretches counted once) */
  totals: { forkliftM: number; powerM: number; waterM: number; pathM: number };
}

interface Node {
  name: string;
  cells: Cell[];
}

function pathLength(points: Point[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y);
  }
  return len;
}

/** Drop collinear interior points so paths render as clean segments. */
function simplify(points: Point[]): Point[] {
  if (points.length < 3) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    const c = points[i + 1];
    const collinear = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
    if (!collinear) out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

function manhattanRun(id: string, from: Point, to: Point): UtilityRun {
  const points = [from, { x: to.x, y: from.y }, to];
  return { id, points, length: Math.abs(to.x - from.x) + Math.abs(to.y - from.y) };
}

function stageNodes(spec: FactorySpec, grid: Grid): Node[][] {
  const inDock = inboundDock(spec);
  const outDock = outboundDock(spec);
  const stages: Node[][] = [];
  stages.push(inDock ? [{ name: 'dock:in', cells: [dockCell(spec, grid, inDock)] }] : []);
  for (const type of spec.routing) {
    stages.push(
      spec.stations
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => s.type === type)
        .map(({ s, i }) => ({ name: s.id, cells: accessCells(grid, i) })),
    );
  }
  stages.push(outDock ? [{ name: 'dock:out', cells: [dockCell(spec, grid, outDock)] }] : []);
  return stages;
}

/**
 * Forklift paths by A* on the grid for each leg of the product flow
 * (inbound dock -> each routing stage in order -> outbound dock), plus
 * Manhattan power and water runs from the utility entry to each station.
 */
export function route(spec: FactorySpec): Routes {
  const grid = buildGrid(spec);
  const stages = stageNodes(spec, grid);
  const forklift: ForkliftPath[] = [];
  const missing: Routes['missing'] = [];
  const legLengths: number[] = [];

  // Conveyors share belt: each path prefers stretches already laid, so the floor gets a few
  // trunks with short spurs instead of one belt per pair of machines. Forklifts take the shortest way.
  const conveyor = spec.transport === 'conveyor';
  const laid = new Set<number>();

  for (let leg = 0; leg < stages.length - 1; leg++) {
    const lens: number[] = [];
    const prev = stages[leg];
    const next = stages[leg + 1];
    const goals = next.flatMap((b) => b.cells);
    const owner = new Map<number, string>();
    for (const b of next) for (const c of b.cells) owner.set(c.r * grid.cols + c.c, b.name);
    const source = new Map<number, string>();
    for (const a of prev) for (const c of a.cells) if (!source.has(c.r * grid.cols + c.c)) source.set(c.r * grid.cols + c.c, a.name);
    const served = new Set<string>();
    const run = (from: Node[], to: Cell[], name?: string) => {
      const starts = from.flatMap((a) => a.cells);
      const cells = conveyor ? trunkPath(grid, starts, to, laid) : astar(grid, starts, to);
      if (!cells) return void missing.push({ from: from[0].name, to: name ?? next[0]?.name ?? 'next step' });
      if (conveyor) layBelt(grid, cells, laid);
      const end = cells[cells.length - 1];
      const target = name ?? owner.get(end.r * grid.cols + end.c) ?? next[0].name;
      served.add(target);
      const points = simplify(cells.map((c) => cellCentre(grid, c.c, c.r)));
      const length = pathLength(points);
      lens.push(length);
      forklift.push({ from: from.length === 1 ? from[0].name : (source.get(cells[0].r * grid.cols + cells[0].c) ?? from[0].name), to: target, leg, points, length });
    };
    // One path per source, to whichever station of the next step is nearest: this is what
    // keeps a 100-station plant routable. Then any station nobody feeds gets a path of its own:
    // by forklift from the step's first station, by conveyor from whichever source is cheapest to tap.
    for (const a of prev) run([a], goals);
    for (const b of next) if (!served.has(b.name) && prev[0]) run(conveyor ? prev : [prev[0]], b.cells, b.name);
    legLengths.push(lens.length ? lens.reduce((x, y) => x + y, 0) / lens.length : 0);
  }

  const power = spec.stations.filter((s) => s.powerKw > 0).map((s) => manhattanRun(s.id, spec.utilityEntry.power, centre(s)));
  const water = spec.stations.filter((s) => s.needsWater).map((s) => manhattanRun(s.id, spec.utilityEntry.water, centre(s)));
  const sum = (xs: { length: number }[]) => xs.reduce((t, x) => t + x.length, 0);

  return {
    forklift,
    legLengths,
    missing,
    power,
    water,
    totals: { forkliftM: legLengths.reduce((a, b) => a + b, 0), powerM: sum(power), waterM: sum(water), pathM: conveyor ? beltLength(grid, laid) : sum(forklift) },
  };
}

export { dockPoint };

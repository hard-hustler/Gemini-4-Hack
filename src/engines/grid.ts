import { dockPoint, footprint, type Dock, type FactorySpec, type Point, type Station } from '../spec';

export interface Grid {
  cols: number;
  rows: number;
  cell: number;
  /** index = r * cols + c; value is the index of the occupying station, or -1 when free */
  owner: Int16Array;
}

export interface Cell {
  c: number;
  r: number;
}

const EPS = 1e-6;

export function buildGrid(spec: FactorySpec): Grid {
  const cell = spec.floor.cellSize;
  const cols = Math.max(1, Math.round(spec.floor.width / cell));
  const rows = Math.max(1, Math.round(spec.floor.depth / cell));
  const owner = new Int16Array(cols * rows).fill(-1);
  spec.stations.forEach((s, i) => {
    const f = footprint(s);
    const c0 = Math.max(0, Math.floor(f.x / cell + EPS));
    const c1 = Math.min(cols - 1, Math.ceil((f.x + f.w) / cell - EPS) - 1);
    const r0 = Math.max(0, Math.floor(f.y / cell + EPS));
    const r1 = Math.min(rows - 1, Math.ceil((f.y + f.d) / cell - EPS) - 1);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) owner[r * cols + c] = i;
  });
  return { cols, rows, cell, owner };
}

export const idx = (g: Grid, c: number, r: number) => r * g.cols + c;
export const isFree = (g: Grid, c: number, r: number) =>
  c >= 0 && r >= 0 && c < g.cols && r < g.rows && g.owner[r * g.cols + c] === -1;

export function cellCentre(g: Grid, c: number, r: number): Point {
  return { x: (c + 0.5) * g.cell, y: (r + 0.5) * g.cell };
}

export function pointToCell(g: Grid, p: Point): Cell {
  return {
    c: Math.min(g.cols - 1, Math.max(0, Math.floor(p.x / g.cell - EPS))),
    r: Math.min(g.rows - 1, Math.max(0, Math.floor(p.y / g.cell - EPS))),
  };
}

export function dockCell(spec: FactorySpec, g: Grid, dock: Dock): Cell {
  return pointToCell(g, dockPoint(spec, dock));
}

const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** Free cells that touch the station's footprint: where a forklift can serve it from. */
export function accessCells(g: Grid, stationIndex: number): Cell[] {
  const out: Cell[] = [];
  const seen = new Set<number>();
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      if (g.owner[idx(g, c, r)] !== stationIndex) continue;
      for (const [dc, dr] of N4) {
        const nc = c + dc;
        const nr = r + dr;
        if (isFree(g, nc, nr) && !seen.has(idx(g, nc, nr))) {
          seen.add(idx(g, nc, nr));
          out.push({ c: nc, r: nr });
        }
      }
    }
  }
  return out;
}

/** Flood fill over free cells from a start cell. Returns a reached mask. */
export function flood(g: Grid, start: Cell): Uint8Array {
  const reached = new Uint8Array(g.cols * g.rows);
  if (!isFree(g, start.c, start.r)) return reached;
  const queue = [start];
  reached[idx(g, start.c, start.r)] = 1;
  while (queue.length) {
    const { c, r } = queue.pop()!;
    for (const [dc, dr] of N4) {
      const nc = c + dc;
      const nr = r + dr;
      if (isFree(g, nc, nr) && !reached[idx(g, nc, nr)]) {
        reached[idx(g, nc, nr)] = 1;
        queue.push({ c: nc, r: nr });
      }
    }
  }
  return reached;
}

/**
 * A* on the 4-connected grid from any of `starts` to any of `goals`.
 * Heuristic: Manhattan distance to the nearest goal (admissible, so the path is shortest).
 */
export function astar(g: Grid, starts: Cell[], goals: Cell[]): Cell[] | null {
  if (!starts.length || !goals.length) return null;
  const n = g.cols * g.rows;
  const goalSet = new Set(goals.map((c) => idx(g, c.c, c.r)));
  const h = (c: number, r: number) => {
    let best = Infinity;
    for (const gl of goals) best = Math.min(best, Math.abs(gl.c - c) + Math.abs(gl.r - r));
    return best;
  };
  const gScore = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  // binary heap of [f, index]
  const heap: [number, number][] = [];
  const push = (f: number, i: number) => {
    heap.push([f, i]);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= heap[k][0]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  for (const s of starts) {
    if (!isFree(g, s.c, s.r)) continue;
    const i = idx(g, s.c, s.r);
    gScore[i] = 0;
    push(h(s.c, s.r), i);
  }
  while (heap.length) {
    const [, i] = pop();
    if (closed[i]) continue;
    closed[i] = 1;
    if (goalSet.has(i)) {
      const path: Cell[] = [];
      for (let k = i; k !== -1; k = came[k]) path.push({ c: k % g.cols, r: Math.floor(k / g.cols) });
      return path.reverse();
    }
    const c = i % g.cols;
    const r = Math.floor(i / g.cols);
    for (const [dc, dr] of N4) {
      const nc = c + dc;
      const nr = r + dr;
      if (!isFree(g, nc, nr)) continue;
      const ni = idx(g, nc, nr);
      const t = gScore[i] + 1;
      if (t < gScore[ni]) {
        gScore[ni] = t;
        came[ni] = i;
        push(t + h(nc, nr), ni);
      }
    }
  }
  return null;
}

export function stationIndexById(spec: FactorySpec, id: string): number {
  return spec.stations.findIndex((s: Station) => s.id === id);
}

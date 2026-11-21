import { GRID_SIZE } from '../data/catalog';

interface NodeRecord {
  idx: number;
  g: number;
  f: number;
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];

export function findDronePath(
  startX: number,
  startZ: number,
  goalX: number,
  goalZ: number,
  blockedCostGrid: Uint8Array
): Array<{ x: number; z: number }> {
  const sx = Math.max(0, Math.min(GRID_SIZE - 1, Math.round(startX)));
  const sz = Math.max(0, Math.min(GRID_SIZE - 1, Math.round(startZ)));
  const gx = Math.max(0, Math.min(GRID_SIZE - 1, Math.round(goalX)));
  const gz = Math.max(0, Math.min(GRID_SIZE - 1, Math.round(goalZ)));

  if (sx === gx && sz === gz) {
    return [{ x: gx, z: gz }];
  }

  const total = GRID_SIZE * GRID_SIZE;
  const gScore = new Float32Array(total);
  gScore.fill(1e9);
  const cameFrom = new Int32Array(total);
  cameFrom.fill(-1);
  const closed = new Uint8Array(total);

  const startIdx = sz * GRID_SIZE + sx;
  const goalIdx = gz * GRID_SIZE + gx;
  gScore[startIdx] = 0;

  const open: NodeRecord[] = [
    {
      idx: startIdx,
      g: 0,
      f: Math.hypot(gx - sx, gz - sz),
    },
  ];

  while (open.length > 0) {
    let bestPos = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestPos].f) bestPos = i;
    }
    const current = open[bestPos];
    open[bestPos] = open[open.length - 1];
    open.pop();

    if (current.idx === goalIdx) {
      const path: Array<{ x: number; z: number }> = [];
      let trace = goalIdx;
      while (trace !== -1 && trace !== startIdx) {
        const tz = Math.floor(trace / GRID_SIZE);
        const tx = trace % GRID_SIZE;
        path.push({ x: tx, z: tz });
        trace = cameFrom[trace];
      }
      path.reverse();
      return path;
    }

    if (closed[current.idx]) continue;
    closed[current.idx] = 1;

    const cx = current.idx % GRID_SIZE;
    const cz = Math.floor(current.idx / GRID_SIZE);

    for (let d = 0; d < DIRS.length; d++) {
      const nx = cx + DIRS[d][0];
      const nz = cz + DIRS[d][1];
      if (nx < 0 || nx >= GRID_SIZE || nz < 0 || nz >= GRID_SIZE) continue;

      const nIdx = nz * GRID_SIZE + nx;
      if (closed[nIdx]) continue;

      const stepDist = d < 4 ? 1 : 1.414;
      // Drones prefer open factory aisles over hovering directly above tall machinery
      const obstaclePenalty = nIdx === goalIdx ? 0 : blockedCostGrid[nIdx] * 0.65;
      const tentativeG = gScore[current.idx] + stepDist + obstaclePenalty;

      if (tentativeG < gScore[nIdx]) {
        cameFrom[nIdx] = current.idx;
        gScore[nIdx] = tentativeG;
        const h = Math.hypot(gx - nx, gz - nz);
        open.push({ idx: nIdx, g: tentativeG, f: tentativeG + h });
      }
    }
  }

  return [{ x: gx, z: gz }];
}

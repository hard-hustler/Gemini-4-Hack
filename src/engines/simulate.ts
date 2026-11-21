import type { FactorySpec } from '../spec';
import { route, type Routes } from './route';

// Discrete-event simulation of one product line.
// Jobs arrive (Poisson) at the inbound dock, a forklift carries each one leg by leg
// through the routing stages, and it leaves at the outbound dock. Stations of the same
// type are parallel servers. Forklifts are a shared FIFO resource, so a long-winded
// layout can make material handling the bottleneck.

export interface LineModel {
  stages: { name: string; servers: { id: string; meanSec: number }[] }[];
  /** metres per leg; length = stages.length + 1 */
  legs: number[];
  arrivalsPerHour: number;
  forklifts: number;
  speedMps: number;
  handlingSec: number;
  /** 'exp' is used to check the sim against queueing theory; 'uniform' is +/-25% around the cycle time */
  service: 'exp' | 'uniform';
  transport: boolean;
  /** conveyors move every unit at once: travel time but no queue for a carrier */
  conveyor?: boolean;
}

export interface SimOptions {
  seeds?: number;
  hours?: number;
  warmupHours?: number;
  service?: 'exp' | 'uniform';
  transport?: boolean;
  routes?: Routes;
}

export interface RunResult {
  unitsPerHour: number;
  wip: number;
  leadTimeSec: number;
  /** mean time waiting in each stage's queue (seconds), same order as model.stages */
  queueWaitSec: number[];
  utilisation: Record<string, number>;
  forkliftMPerHour: number;
}

export interface Band {
  low: number;
  median: number;
  high: number;
}

export interface SimResult {
  unitsPerHour: Band;
  wip: Band;
  leadTimeSec: Band;
  /** mean utilisation per stage name, plus "forklift" */
  utilisation: Record<string, number>;
  bottleneck: { name: string; utilisation: number };
  forkliftMPerHour: number;
  seeds: number;
}

export const FORKLIFT_SPEED_MPS = 1.5;
export const HANDLING_SEC = 8;
export const CONVEYOR_SPEED_MPS = 0.4;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildModel(spec: FactorySpec, opts: SimOptions = {}): LineModel {
  const routes = opts.routes ?? route(spec);
  return {
    stages: spec.routing.map((type) => ({
      name: type,
      servers: spec.stations.filter((s) => s.type === type).map((s) => ({ id: s.id, meanSec: s.cycleTimeSec })),
    })),
    legs: routes.legLengths,
    arrivalsPerHour: spec.demandPerHour,
    forklifts: Math.max(1, spec.forklifts ?? 1),
    speedMps: FORKLIFT_SPEED_MPS,
    handlingSec: HANDLING_SEC,
    service: opts.service ?? 'uniform',
    transport: opts.transport ?? true,
    conveyor: spec.transport === 'conveyor',
  };
}

type Ev =
  | { t: number; kind: 'arrive' }
  | { t: number; kind: 'moved'; job: number; leg: number; usedFork: boolean }
  | { t: number; kind: 'served'; job: number; stage: number; server: number };

class Heap {
  private a: Ev[] = [];
  get size() {
    return this.a.length;
  }
  push(e: Ev) {
    const a = this.a;
    a.push(e);
    let k = a.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (a[p].t <= a[k].t) break;
      [a[p], a[k]] = [a[k], a[p]];
      k = p;
    }
  }
  pop(): Ev {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < a.length && a[l].t < a[m].t) m = l;
        if (r < a.length && a[r].t < a[m].t) m = r;
        if (m === k) break;
        [a[m], a[k]] = [a[k], a[m]];
        k = m;
      }
    }
    return top;
  }
}

export function simulateOnce(model: LineModel, seed: number, hours = 8, warmupHours = 1): RunResult {
  const rnd = mulberry32(seed);
  const exp = (mean: number) => -mean * Math.log(1 - rnd());
  const svc = (mean: number) => (model.service === 'exp' ? exp(mean) : mean * (0.75 + 0.5 * rnd()));
  const t0 = warmupHours * 3600;
  const t1 = (warmupHours + hours) * 3600;
  const windowSec = t1 - t0;
  const overlap = (a: number, b: number) => Math.max(0, Math.min(b, t1) - Math.max(a, t0));

  const n = model.stages.length;
  const heap = new Heap();
  const stageQueue: { job: number; since: number }[][] = model.stages.map(() => []);
  const busy: boolean[][] = model.stages.map((s) => s.servers.map(() => false));
  const stageBusy = new Array(n).fill(0);
  const waitSum = new Array(n).fill(0);
  const waitCount = new Array(n).fill(0);
  const forkQueue: { job: number; leg: number }[] = [];
  let forkFree = model.forklifts;
  let forkBusy = 0;
  let forkMetres = 0;
  const born: number[] = [];
  let inSystem = 0;
  let wipArea = 0;
  let lastT = 0;
  let done = 0;
  let leadSum = 0;

  const meanGap = 3600 / model.arrivalsPerHour;
  if (model.arrivalsPerHour > 0) heap.push({ t: exp(meanGap), kind: 'arrive' });

  const startMove = (t: number, job: number, leg: number) => {
    const dur = model.legs[leg] / model.speedMps + model.handlingSec;
    forkBusy += overlap(t, t + dur);
    if (t >= t0 && t < t1) forkMetres += model.legs[leg];
    heap.push({ t: t + dur, kind: 'moved', job, leg, usedFork: true });
  };
  const requestMove = (t: number, job: number, leg: number) => {
    if (!model.transport) {
      heap.push({ t, kind: 'moved', job, leg, usedFork: false });
    } else if (model.conveyor) {
      heap.push({ t: t + model.legs[leg] / CONVEYOR_SPEED_MPS, kind: 'moved', job, leg, usedFork: false });
    } else if (forkFree > 0) {
      forkFree--;
      startMove(t, job, leg);
    } else {
      forkQueue.push({ job, leg });
    }
  };
  const startService = (t: number, job: number, stage: number, server: number, since: number) => {
    busy[stage][server] = true;
    const dur = svc(model.stages[stage].servers[server].meanSec);
    stageBusy[stage] += overlap(t, t + dur);
    if (t >= t0 && t < t1) {
      waitSum[stage] += t - since;
      waitCount[stage]++;
    }
    heap.push({ t: t + dur, kind: 'served', job, stage, server });
  };

  while (heap.size) {
    const ev = heap.pop();
    if (ev.t > t1) break;
    wipArea += inSystem * overlap(lastT, ev.t);
    lastT = ev.t;
    if (ev.kind === 'arrive') {
      const job = born.length;
      born.push(ev.t);
      inSystem++;
      heap.push({ t: ev.t + exp(meanGap), kind: 'arrive' });
      requestMove(ev.t, job, 0);
    } else if (ev.kind === 'moved') {
      if (ev.usedFork) {
        const next = forkQueue.shift();
        if (next) startMove(ev.t, next.job, next.leg);
        else forkFree++;
      }
      if (ev.leg === n) {
        inSystem--;
        if (ev.t >= t0) {
          done++;
          leadSum += ev.t - born[ev.job];
        }
      } else {
        const free = busy[ev.leg].indexOf(false);
        if (free >= 0) startService(ev.t, ev.job, ev.leg, free, ev.t);
        else stageQueue[ev.leg].push({ job: ev.job, since: ev.t });
      }
    } else {
      busy[ev.stage][ev.server] = false;
      const next = stageQueue[ev.stage].shift();
      if (next) startService(ev.t, next.job, ev.stage, ev.server, next.since);
      requestMove(ev.t, ev.job, ev.stage + 1);
    }
  }
  wipArea += inSystem * overlap(lastT, t1);

  const utilisation: Record<string, number> = {};
  model.stages.forEach((s, i) => {
    utilisation[s.name] = s.servers.length ? stageBusy[i] / (s.servers.length * windowSec) : 0;
  });
  if (model.transport && !model.conveyor) utilisation.forklift = forkBusy / (model.forklifts * windowSec);

  return {
    unitsPerHour: done / hours,
    wip: wipArea / windowSec,
    leadTimeSec: done ? leadSum / done : 0,
    queueWaitSec: waitSum.map((w, i) => (waitCount[i] ? w / waitCount[i] : 0)),
    utilisation,
    forkliftMPerHour: forkMetres / hours,
  };
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function band(xs: number[]): Band {
  const s = [...xs].sort((a, b) => a - b);
  return { low: quantile(s, 0.1), median: quantile(s, 0.5), high: quantile(s, 0.9) };
}

export function simulateModel(model: LineModel, seeds = 30, hours = 8, warmupHours = 1): SimResult {
  const runs = Array.from({ length: seeds }, (_, i) => simulateOnce(model, 1000 + i * 7919, hours, warmupHours));
  const utilisation: Record<string, number> = {};
  for (const key of Object.keys(runs[0]?.utilisation ?? {})) {
    utilisation[key] = runs.reduce((t, r) => t + r.utilisation[key], 0) / runs.length;
  }
  const [name, u] = Object.entries(utilisation).sort((a, b) => b[1] - a[1])[0] ?? ['none', 0];
  return {
    unitsPerHour: band(runs.map((r) => r.unitsPerHour)),
    wip: band(runs.map((r) => r.wip)),
    leadTimeSec: band(runs.map((r) => r.leadTimeSec)),
    utilisation,
    bottleneck: { name, utilisation: u },
    forkliftMPerHour: runs.reduce((t, r) => t + r.forkliftMPerHour, 0) / Math.max(1, runs.length),
    seeds,
  };
}

/** Low / median / high are the 10th / 50th / 90th percentile across seeds. */
export function simulate(spec: FactorySpec, seedsOrOpts: number | SimOptions = 30): SimResult {
  const opts = typeof seedsOrOpts === 'number' ? { seeds: seedsOrOpts } : seedsOrOpts;
  return simulateModel(buildModel(spec, opts), opts.seeds ?? 30, opts.hours ?? 8, opts.warmupHours ?? 1);
}

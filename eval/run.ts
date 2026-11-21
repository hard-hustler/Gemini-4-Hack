// Eval harness. Run: npx tsx --env-file=.env eval/run.ts   (writes public/eval/results.json)
// 1. Layout quality on QAPLIB Nugent instances: gap to best-known for one model call vs the harness.
// 2. Validity: share of layouts passing validate() on unseen plans, one call vs harness.
// 3. Simulator sanity: queue wait vs the textbook M/M/c formula.
// Failures are recorded, not hidden.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mulberry32, simulateOnce, type LineModel } from '../src/engines/simulate';
import { interact, MODELS, type Step } from '../server/gemini';
import { layoutProject, planProject } from '../server/harness';
import { PipelineError, readPlan } from '../server/pipeline';
import { validate } from '../src/engines/validate';
import type { FactorySpec } from '../src/spec';

const here = dirname(fileURLToPath(import.meta.url));
const only = process.argv[2]; // optional: qap | validity | queue

// ---------- 1. QAP ----------
interface Qap {
  name: string;
  n: number;
  A: number[][];
  B: number[][];
  best: number;
  bestPerm: number[];
}

function loadQap(name: string): Qap {
  const nums = readFileSync(join(here, 'qaplib', `${name}.dat`), 'utf8').split(/\s+/).filter(Boolean).map(Number);
  const n = nums[0];
  const mat = (o: number) => Array.from({ length: n }, (_, i) => nums.slice(o + i * n, o + (i + 1) * n));
  const sln = readFileSync(join(here, 'qaplib', `${name}.sln`), 'utf8').split(/\s+/).filter(Boolean).map(Number);
  return { name, n, A: mat(1), B: mat(1 + n * n), best: sln[1], bestPerm: sln.slice(2, 2 + n).map((v) => v - 1) };
}

/** cost = sum_ij A[i][j] * B[p[i]][p[j]] */
const qapCost = (q: Qap, p: number[]) => {
  let c = 0;
  for (let i = 0; i < q.n; i++) for (let j = 0; j < q.n; j++) c += q.A[i][j] * q.B[p[i]][p[j]];
  return c;
};

const permErrors = (n: number, p: unknown): string[] => {
  if (!Array.isArray(p)) return ['assignment is not an array'];
  const errs: string[] = [];
  if (p.length !== n) errs.push(`assignment has ${p.length} entries; it must have exactly ${n}`);
  const seen = new Map<number, number>();
  p.forEach((v, i) => {
    if (!Number.isInteger(v) || v < 1 || v > n) errs.push(`entry ${i + 1} is ${v}; it must be an integer from 1 to ${n}`);
    else if (seen.has(v)) errs.push(`value ${v} is used at positions ${seen.get(v)! + 1} and ${i + 1}; each value must appear once`);
    else seen.set(v, i);
  });
  for (let v = 1; v <= n; v++) if (!seen.has(v)) errs.push(`value ${v} is missing`);
  return errs.slice(0, 12);
};

/** Iterated local search: best-improvement pairwise swaps, random kicks, fixed seeded budget. */
function improve(q: Qap, start: number[], seed: number, kicks: number): { perm: number[]; cost: number } {
  const rnd = mulberry32(seed);
  const descend = (p: number[]) => {
    let cost = qapCost(q, p);
    for (;;) {
      let bestD = 0;
      let bi = -1;
      let bj = -1;
      for (let i = 0; i < q.n; i++)
        for (let j = i + 1; j < q.n; j++) {
          [p[i], p[j]] = [p[j], p[i]];
          const d = qapCost(q, p) - cost;
          [p[i], p[j]] = [p[j], p[i]];
          if (d < bestD) [bestD, bi, bj] = [d, i, j];
        }
      if (bi < 0) return cost;
      [p[bi], p[bj]] = [p[bj], p[bi]];
      cost += bestD;
    }
  };
  let best = [...start];
  let bestCost = descend(best);
  for (let k = 0; k < kicks; k++) {
    const p = [...best];
    for (let s = 0; s < 3; s++) {
      const i = Math.floor(rnd() * q.n);
      const j = Math.floor(rnd() * q.n);
      [p[i], p[j]] = [p[j], p[i]];
    }
    const c = descend(p);
    if (c < bestCost) [best, bestCost] = [p, c];
  }
  return { perm: best, cost: bestCost };
}

const fmt = (m: number[][]) => m.map((r) => r.join(' ')).join('\n');
const gap = (cost: number, best: number) => +(((cost - best) / best) * 100).toFixed(2);

async function evalQap(name: string) {
  const q = loadQap(name);
  const check = qapCost(q, q.bestPerm);
  const kicks = q.n <= 20 ? 60 : 25;
  const out: any = { instance: name, n: q.n, bestKnown: q.best, source: 'QAPLIB (coral.ise.lehigh.edu), nug*.dat / nug*.sln', dataCheck: check === q.best ? 'published solution reproduces best-known cost' : `MISMATCH: published permutation costs ${check}` };

  const schema = { type: 'object', properties: { assignment: { type: 'array', items: { type: 'integer' }, description: `exactly ${q.n} integers, a permutation of 1..${q.n}` } }, required: ['assignment'] };
  const system = `You solve a facility layout problem (quadratic assignment). There are ${q.n} facilities and ${q.n} locations. Matrix A is given by facility pairs and matrix B by location pairs. Choose assignment[i] = the location (1..${q.n}) of facility i+1, a permutation, to minimise the sum over all i,j of A[i][j] * B[assignment[i]][assignment[j]]. Put pairs with large A values at locations with small B values. Emit only the assignment.`;
  const steps: Step[] = [{ type: 'user_input', content: [{ type: 'text', text: `Matrix A (${q.n}x${q.n}):\n${fmt(q.A)}\n\nMatrix B (${q.n}x${q.n}):\n${fmt(q.B)}` }] }];

  // (a) one model call, taken as-is
  let start: number[] | null = null;
  const attempts: { ms: number; errors: string[] }[] = [];
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await interact<any>({ model: MODELS.neon, input: steps, system, schema, thinking: 'low' });
      const errs = permErrors(q.n, res.json?.assignment);
      attempts.push({ ms: res.ms, errors: errs });
      if (attempt === 1) {
        out.oneCall = errs.length ? { valid: false, errors: errs, ms: res.ms } : { valid: true, cost: qapCost(q, res.json.assignment.map((v: number) => v - 1)), ms: res.ms };
        if (out.oneCall.valid) out.oneCall.gapPct = gap(out.oneCall.cost, q.best);
      }
      if (!errs.length) {
        start = res.json.assignment.map((v: number) => v - 1);
        break;
      }
      // harness: feed the specific errors back and retry
      steps.push({ type: 'model_output', content: [{ type: 'text', text: res.text }] });
      steps.push({ type: 'user_input', content: [{ type: 'text', text: `That assignment is not a valid permutation of 1..${q.n}. Fix it and emit the full assignment.\n${errs.map((e) => `- ${e}`).join('\n')}` }] });
    }
  } catch (e) {
    out.modelError = (e as Error).message;
    out.oneCall ??= { valid: false, errors: [(e as Error).message] };
  }

  // (b) harness: validated model proposal -> seeded local search
  const t = Date.now();
  if (start) {
    const h = improve(q, start, 7, kicks);
    out.harness = { valid: true, cost: h.cost, gapPct: gap(h.cost, q.best), modelAttempts: attempts.length, searchMs: Date.now() - t };
  } else {
    out.harness = { valid: false, modelAttempts: attempts.length, note: 'model never produced a valid permutation; harness had nothing to refine' };
  }
  // control: the same search from a random start, to show how much is the model and how much is the search
  const rnd = mulberry32(99);
  const random = Array.from({ length: q.n }, (_, i) => i).sort(() => rnd() - 0.5);
  out.randomStart = { cost: qapCost(q, random), gapPct: gap(qapCost(q, random), q.best) };
  const ctl = improve(q, random, 7, kicks);
  out.searchOnly = { cost: ctl.cost, gapPct: gap(ctl.cost, q.best) };
  return out;
}

// ---------- 2. Validity and faithfulness on unseen plans ----------
// Three ways to turn the same brief into a layout:
//   one call      the model emits coordinates, first answer taken as-is
//   retry loop    the model emits coordinates, validate() errors fed back up to 3 times (old harness)
//   plan + placer the model emits requirements only, code places the equipment (what ships)
// "Faithful" means the layout has exactly the station counts and floor size the brief asked for.
interface UnseenPlan {
  id: number;
  stations: number;
  width: number;
  depth: number;
  counts: Record<string, number>;
  text: string;
  /** the brief contradicts itself, so there is no single right station count */
  ambiguous: boolean;
}

function unseenPlans(count: number): UnseenPlan[] {
  const rnd = mulberry32(2026);
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const kinds = ['storage', 'prep', 'assembly', 'test', 'pack', 'weld', 'paint', 'inspect', 'label', 'kitting'];
  return Array.from({ length: count }, (_, i) => {
    // later plans are tighter: more stations on a smaller floor
    const stations = 5 + i;
    const width = Math.round(22 - i * 1.1);
    const depth = Math.round(15 - i * 0.7);
    const flow = [...kinds].sort(() => rnd() - 0.5).slice(0, Math.min(kinds.length, 4 + Math.floor(i / 2)));
    const counts = flow.map(() => 1);
    for (let k = flow.length; k < stations; k++) counts[Math.floor(rnd() * flow.length)]++;
    const walls = ['north', 'south', 'east', 'west'];
    const text = `Plan ${i + 1}. A workshop ${width} m wide (east-west) by ${depth} m deep (north-south). Goods come in through a dock on the ${pick(walls)} wall and leave through a dock on the ${pick(walls)} wall. Process flow: ${flow.join(' then ')}. Equipment: ${flow.map((f, k) => `${counts[k]} ${f} station${counts[k] > 1 ? 's' : ''}`).join(', ')}. Demand is ${20 + Math.floor(rnd() * 25)} units per hour. Power comes in at the ${pick(walls)} wall and water at the ${pick(walls)} wall. ${pick(['Keep the middle of the floor clear for a main aisle.', 'Put storage right beside the inbound dock.', 'Line the stations along the walls.', 'Group stations of the same type side by side.'])}`;
    // found after the first run: one hint mentions storage even when the equipment list has none
    const ambiguous = text.includes('Put storage') && !flow.includes('storage');
    return { id: i + 1, stations, width, depth, counts: Object.fromEntries(flow.map((f, k) => [f, counts[k]])), text, ambiguous };
  });
}

function faithful(p: UnseenPlan, spec: FactorySpec): boolean {
  const got: Record<string, number> = {};
  for (const s of spec.stations) got[s.type] = (got[s.type] ?? 0) + 1;
  const sameCounts = Object.keys({ ...got, ...p.counts }).every((k) => got[k] === p.counts[k]);
  return sameCounts && spec.floor.width === p.width && spec.floor.depth === p.depth;
}

async function evalValidity(count = 10) {
  const plans = unseenPlans(count);
  const rows = await Promise.all(
    plans.map(async (p) => {
      const row: any = { id: p.id, stations: p.stations, floor: `${p.width}x${p.depth}`, ambiguous: p.ambiguous, brief: p.text };
      // model places (one call, then the retry loop)
      try {
        const r = await readPlan({ type: 'text', text: p.text });
        row.oneCallValid = r.attempts[0].errors.length === 0;
        row.retryValid = true;
        row.retryAttempts = r.attempts.length;
        row.retryFirstError = r.attempts[0].errors[0];
        row.retryStations = r.spec.stations.length;
        row.retryFaithful = faithful(p, r.spec);
      } catch (e) {
        row.oneCallValid = false;
        row.retryValid = false;
        row.retryFaithful = false;
        if (e instanceof PipelineError) {
          row.retryAttempts = e.attempts.length;
          row.retryFirstError = e.attempts[0]?.errors[0];
        } else row.retryError = (e as Error).message;
      }
      // code places (plan + placer)
      try {
        const plan = await planProject(p.text, []);
        row.planAttempts = plan.trace.filter((t) => t.actor === 'hydrogen').length;
        row.coverage = plan.coverage === undefined ? undefined : +plan.coverage.toFixed(2);
        const lay = layoutProject(plan.requirements, plan.equipment);
        row.placerValid = validate(lay.spec).length === 0;
        row.placerStations = lay.spec.stations.length;
        row.placerFaithful = faithful(p, lay.spec);
        if (!row.placerFaithful) row.placerNote = `got ${lay.spec.stations.length} stations on ${lay.spec.floor.width}x${lay.spec.floor.depth}`;
      } catch (e) {
        row.placerValid = false;
        row.placerFaithful = false;
        row.placerError = [(e as Error).message, ...(((e as any).lines as string[] | undefined) ?? [])].join(' | ').slice(0, 240);
      }
      return row;
    }),
  );
  const share = (k: string) => +(rows.filter((r) => r[k]).length / rows.length).toFixed(2);
  const clear = rows.filter((r) => !r.ambiguous);
  const clearShare = (k: string) => +(clear.filter((r) => r[k]).length / Math.max(1, clear.length)).toFixed(2);
  return {
    n: rows.length,
    model: MODELS.hydrogen,
    oneCallValidShare: share('oneCallValid'),
    retryValidShare: share('retryValid'),
    placerValidShare: share('placerValid'),
    retryFaithfulShare: share('retryFaithful'),
    placerFaithfulShare: share('placerFaithful'),
    ambiguousBriefs: rows.length - clear.length,
    retryFaithfulShareClearBriefs: clearShare('retryFaithful'),
    placerFaithfulShareClearBriefs: clearShare('placerFaithful'),
    rows,
  };
}

// ---------- 3. Simulator sanity ----------
function mmc(lambdaPerHour: number, meanSec: number, c: number) {
  const lambda = lambdaPerHour / 3600;
  const mu = 1 / meanSec;
  const a = lambda / mu;
  const rho = a / c;
  let sum = 0;
  let term = 1;
  for (let k = 0; k < c; k++) {
    if (k > 0) term *= a / k;
    sum += term;
  }
  const last = (term * a) / c / (1 - rho); // a^c / c! / (1 - rho)
  const erlangC = last / (sum + last);
  return { rho, wq: erlangC / (c * mu - lambda) };
}

function evalQueue() {
  const cases = [
    { name: 'M/M/1 rho 0.50', lambda: 30, mean: 60, c: 1 },
    { name: 'M/M/1 rho 0.75', lambda: 45, mean: 60, c: 1 },
    { name: 'M/M/1 rho 0.90', lambda: 54, mean: 60, c: 1 },
    { name: 'M/M/2 rho 0.80', lambda: 96, mean: 60, c: 2 },
  ];
  return cases.map((k) => {
    const model: LineModel = {
      stages: [{ name: 's', servers: Array.from({ length: k.c }, (_, i) => ({ id: `s${i}`, meanSec: k.mean })) }],
      legs: [0, 0],
      arrivalsPerHour: k.lambda,
      forklifts: 1,
      speedMps: 1,
      handlingSec: 0,
      service: 'exp',
      transport: false,
    };
    const runs = Array.from({ length: 30 }, (_, i) => simulateOnce(model, 500 + i, 400, 20));
    const wq = runs.reduce((t, r) => t + r.queueWaitSec[0], 0) / runs.length;
    const util = runs.reduce((t, r) => t + r.utilisation.s, 0) / runs.length;
    const th = mmc(k.lambda, k.mean, k.c);
    const errPct = +(((wq - th.wq) / th.wq) * 100).toFixed(2);
    return { case: k.name, theoryWqSec: +th.wq.toFixed(2), simWqSec: +wq.toFixed(2), errorPct: errPct, theoryUtil: +th.rho.toFixed(3), simUtil: +util.toFixed(3), pass: Math.abs(errPct) < 5 };
  });
}

// ---------- run ----------
const outFile = join(here, '..', 'public', 'eval', 'results.json');
let results: any = {};
try {
  results = JSON.parse(readFileSync(outFile, 'utf8'));
} catch {
  /* first run */
}
results.generatedAt = new Date().toISOString();
if (!only || only === 'queue') results.queue = evalQueue();
if (!only || only === 'qap') results.qap = await Promise.all(['nug12', 'nug15', 'nug20', 'nug30'].map(evalQap));
if (!only || only === 'validity') results.validity = await evalValidity();
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(results, null, 2));
console.log(JSON.stringify({ queue: results.queue, qap: results.qap, validity: results.validity }, null, 1));

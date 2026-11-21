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
import { PipelineError, readPlan } from '../server/pipeline';

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

// ---------- 2. Validity on unseen plans ----------
function unseenPlans(count: number) {
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
    return { id: i + 1, stations, floor: `${width}x${depth}`, text };
  });
}

async function evalValidity(count = 10) {
  const plans = unseenPlans(count);
  const rows = await Promise.all(
    plans.map(async (p) => {
      try {
        const r = await readPlan({ type: 'text', text: p.text });
        return { ...p, firstCallValid: r.attempts[0].errors.length === 0, harnessValid: true, attempts: r.attempts.length, firstErrors: r.attempts[0].errors.slice(0, 3), gotStations: r.spec.stations.length };
      } catch (e) {
        if (e instanceof PipelineError) return { ...p, firstCallValid: false, harnessValid: false, attempts: e.attempts.length, firstErrors: e.attempts[0]?.errors.slice(0, 3) ?? [], lastErrors: e.errors.map((x) => x.message).slice(0, 3) };
        return { ...p, firstCallValid: false, harnessValid: false, attempts: 0, firstErrors: [], apiError: (e as Error).message };
      }
    }),
  );
  const share = (k: 'firstCallValid' | 'harnessValid') => +(rows.filter((r) => r[k]).length / rows.length).toFixed(2);
  const wrongCount = rows.filter((r: any) => r.harnessValid && r.gotStations !== r.stations).length;
  return { n: rows.length, model: MODELS.hydrogen, oneCallValidShare: share('firstCallValid'), harnessValidShare: share('harnessValid'), validButWrongStationCount: wrongCount, rows };
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
console.log(JSON.stringify({ queue: results.queue, qap: results.qap, validity: results.validity && { ...results.validity, rows: results.validity.rows.map((r: any) => ({ id: r.id, st: r.stations, floor: r.floor, first: r.firstCallValid, harness: r.harnessValid, attempts: r.attempts, err: r.firstErrors?.[0] ?? r.apiError })) } }, null, 1));

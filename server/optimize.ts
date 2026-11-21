// Neon proposes, code disposes.
// propose (Neon) -> validate -> feed errors back once -> gate (Decisions API) -> simulate in parallel -> rank.

import { compare, evaluate, type Metrics } from '../src/engines/versions';
import { route } from '../src/engines/route';
import { objective } from '../src/engines/search';
import { validate } from '../src/engines/validate';
import { applyOps, type EditOp, type FactorySpec } from '../src/spec';
import { decide, interact, MODELS, type Question, type Step } from './gemini';
import { errorText, GEOMETRY_RULES, opsSchema, toOps } from './pipeline';

export const proposalSchema = {
  type: 'object',
  properties: {
    explanation: { type: 'string', description: 'two sentences: what the bottleneck is and why, in plain words, using the numbers given' },
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'three or four word label' },
          reason: { type: 'string', description: 'one line: why this should help' },
          ops: (opsSchema as any).properties.ops,
        },
        required: ['name', 'reason', 'ops'],
      },
    },
  },
  required: ['explanation', 'candidates'],
};

export interface Candidate {
  name: string;
  reason: string;
  ops: EditOp[];
  status: 'evaluated' | 'invalid' | 'gated_out';
  errors?: string[];
  /** Decisions API: 0..1, how promising the gate thought this was before simulation */
  gate?: number;
  /** true when the first proposal failed validation and Neon repaired it */
  repaired?: boolean;
  spec?: FactorySpec;
  metrics?: Metrics;
  /** lower is better; base is 1.0 */
  score?: number;
  deltas?: { uph: number; leadMin: number; costPerUnit: number; buildCost: number; forkliftM: number };
}

export function situation(spec: FactorySpec, m: Metrics): string {
  const r = route(spec);
  const legs = ['dock in', ...spec.routing, 'dock out'];
  return [
    `Units/hour ${m.sim.unitsPerHour.median.toFixed(1)} against demand ${spec.demandPerHour}.`,
    `Bottleneck: ${m.sim.bottleneck.name} at ${(m.sim.bottleneck.utilisation * 100).toFixed(0)}% busy.`,
    `Utilisation: ${Object.entries(m.sim.utilisation).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(', ')}.`,
    `Lead time ${(m.sim.leadTimeSec.median / 60).toFixed(1)} min, WIP ${m.sim.wip.median.toFixed(1)} units.`,
    `Forklift legs (m): ${r.legLengths.map((l, i) => `${legs[i]}->${legs[i + 1]} ${l.toFixed(1)}`).join(', ')}; ${spec.forklifts ?? 1} forklift(s).`,
    `Cost/unit $${m.cost.costPerUnit.toFixed(2)}; build $${m.cost.buildCost.toFixed(0)} of which utility runs $${m.cost.utilityRunCost.toFixed(0)} (power ${r.totals.powerM.toFixed(0)} m, water ${r.totals.waterM.toFixed(0)} m).`,
  ].join('\n');
}

export async function optimise(spec: FactorySpec, opts: { count?: number; keep?: number } = {}) {
  const count = opts.count ?? 6;
  const keep = opts.keep ?? 4;
  const started = Date.now();
  const baseEv = evaluate(spec);
  if (!baseEv.ok) throw new Error('The current layout is not valid: ' + baseEv.errors.map((e) => e.message).join('; '));
  const base = baseEv.metrics;
  const facts = situation(spec, base);

  const system = `You improve a factory layout. You get the current FactorySpec as JSON and its simulated metrics. Propose ${count} different candidate changes, each a short list of edit ops with a one-line reason. Never describe a layout in prose.
Aim: shorter lead time and lower cost per unit and build cost, without losing throughput. Shorten forklift legs by putting consecutive stages near each other and near the right dock; shorten power and water runs; relieve the bottleneck. Make the candidates genuinely different from each other (different stations moved, a dock move, a combined rearrangement). Adding stations or forklifts costs money, so at most one candidate may add equipment or forklifts.
Ops: move {id,x,y}; rotate {id,rot}; add {station}; remove {id}; moveDock {index,wall,offset}; setParam {path,value} (path: forklifts or stations.<id>.<field>). Set fields an op does not use to null. Do not change demandPerHour or costs.
${GEOMETRY_RULES}`;

  const steps: Step[] = [{ type: 'user_input', content: [{ type: 'text', text: `Current spec:\n${JSON.stringify(spec)}\n\nSimulated metrics:\n${facts}` }] }];
  const first = await interact<any>({ model: MODELS.neon, input: steps, system, schema: proposalSchema, thinking: 'low' });
  const explanation = String(first.json?.explanation ?? '');

  const check = (raw: any): Candidate => {
    const c: Candidate = { name: String(raw?.name ?? 'candidate'), reason: String(raw?.reason ?? ''), ops: [], status: 'invalid' };
    try {
      c.ops = toOps(Array.isArray(raw?.ops) ? raw.ops : []);
      if (!c.ops.length) throw new Error('No ops');
      const next = applyOps(spec, c.ops);
      const errs = validate(next);
      if (errs.length) c.errors = errs.map((e) => e.message);
      else {
        c.spec = next;
        c.status = 'evaluated';
      }
    } catch (e) {
      c.errors = [(e as Error).message];
    }
    return c;
  };

  let candidates: Candidate[] = (Array.isArray(first.json?.candidates) ? first.json.candidates : []).map(check);
  const firstPassValid = candidates.filter((c) => c.spec).length;
  const proposed = candidates.length;

  // One repair round: tell Neon exactly which candidates failed and why.
  const broken = candidates.filter((c) => !c.spec);
  let repairMs = 0;
  if (broken.length) {
    steps.push({ type: 'model_output', content: [{ type: 'text', text: first.text }] });
    steps.push({
      type: 'user_input',
      content: [
        {
          type: 'text',
          text: `These candidates failed validation when applied to the current spec. Emit corrected versions of only these, same names, each as a full op list applied to the original spec.\n${broken.map((c) => `"${c.name}":\n${errorText((c.errors ?? []).map((message) => ({ code: 'param' as const, message, ids: [] })))}`).join('\n')}`,
        },
      ],
    });
    try {
      const fix = await interact<any>({ model: MODELS.neon, input: steps, system, schema: proposalSchema, thinking: 'low' });
      repairMs = fix.ms;
      for (const raw of Array.isArray(fix.json?.candidates) ? fix.json.candidates : []) {
        const fixed = check(raw);
        const i = candidates.findIndex((c) => !c.spec && c.name === fixed.name);
        if (i >= 0 && fixed.spec) candidates[i] = { ...fixed, repaired: true };
      }
    } catch (e) {
      console.error('repair round failed', (e as Error).message);
    }
  }

  // Cheap gate before simulation: one Decisions call scores every valid candidate.
  const valid = candidates.filter((c) => c.spec);
  let gateMs = 0;
  let gateError: string | undefined;
  if (valid.length) {
    const questions: Record<string, Question> = {};
    valid.forEach((c, i) => {
      questions[`c${i}`] = {
        type: 'score',
        instructions: `A proposed change to this factory layout: "${c.name}". Ops: ${JSON.stringify(c.ops)}. Reason given: ${c.reason}. How much is this change likely to shorten lead time and cut cost per unit without losing throughput?`,
        criteria: ['likely to make things worse', 'no real effect', 'small improvement', 'clear improvement', 'large improvement'],
      };
    });
    try {
      const g = await decide(`Factory layout spec:\n${JSON.stringify(spec)}\n\nSimulated metrics:\n${facts}`, questions);
      gateMs = g.ms;
      valid.forEach((c, i) => {
        const a = g.answers[`c${i}`];
        if (a?.type === 'score') c.gate = a.score / 4;
      });
      const ranked = [...valid].sort((a, b) => (b.gate ?? 0) - (a.gate ?? 0));
      ranked.slice(keep).forEach((c) => (c.status = 'gated_out'));
    } catch (e) {
      gateError = (e as Error).message; // gate is an optimisation: on failure simulate everything
    }
  }

  // Evaluate the survivors in parallel. (Engines are sync and ~30 ms each; Promise.all keeps the shape
  // ready for remote evaluators.) Gated-out candidates are simulated too, flagged, so the gate can be audited.
  const simStart = Date.now();
  await Promise.all(
    valid.map(async (c) => {
      const ev = evaluate(c.spec!);
      if (!ev.ok) {
        c.status = 'invalid';
        c.errors = ev.errors.map((e) => e.message);
        return;
      }
      c.metrics = ev.metrics;
      c.score = objective(base, ev.metrics);
      const rows = Object.fromEntries(compare(base, ev.metrics).map((r) => [r.key, r.delta]));
      c.deltas = { uph: rows.uph, leadMin: rows.lead, costPerUnit: rows.cpu, buildCost: rows.build, forkliftM: rows.fork };
    }),
  );
  const simMs = Date.now() - simStart;

  candidates = candidates.sort((a, b) => {
    const rank = (c: Candidate) => (c.status === 'evaluated' ? 0 : c.status === 'gated_out' ? 1 : 2);
    return rank(a) - rank(b) || (a.score ?? 9) - (b.score ?? 9);
  });

  return {
    explanation,
    base,
    candidates: candidates.map(({ spec: s, metrics: _m, ...rest }) => ({ ...rest, spec: rest.status === 'invalid' ? undefined : s })),
    stats: { proposed, firstPassValid, validAfterRepair: valid.length, gateError, ms: { propose: first.ms, repair: repairMs, gate: gateMs, simulate: simMs, total: Date.now() - started } },
  };
}

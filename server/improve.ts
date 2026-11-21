// Goal-driven improve loop. One run is several rounds of:
//
//   Neon proposes changes for the goal (it sees what earlier rounds tried and how each turned out)
//     -> validate() rejects anything that breaks a layout rule; the reasons go into the next round
//     -> Decisions API scores the survivors before any simulation (the cheap gate)
//     -> a seeded search adds its own candidate, so the model competes with plain code
//     -> the simulator scores everything that passed the gate
//     -> the best one is kept only if it beats the current layout on the goal
//
// The loop stops when a round finds nothing better, or after MAX_ROUNDS.

import type { Emit } from '../src/contracts';
import { localSearch, opsBetween } from '../src/engines/search';
import { validate } from '../src/engines/validate';
import { compare, evaluate, type Metrics } from '../src/engines/versions';
import { applyOps, type EditOp, type FactorySpec } from '../src/spec';
import { decide, interact, MODELS, type Question } from './gemini';
import { proposalSchema, situation } from './optimize';
import { GEOMETRY_RULES, toOps } from './pipeline';

export type Goal = 'cost' | 'lead' | 'build';
const MAX_ROUNDS = 3;
const PER_ROUND = 4;
const KEEP_AFTER_GATE = 3;

const GOALS: Record<Goal, { label: string; brief: string; w: { unit: number; lead: number; build: number } }> = {
  cost: { label: 'lowest cost per unit', brief: 'Meet demand at the lowest running cost per unit.', w: { unit: 0.7, lead: 0.15, build: 0.15 } },
  lead: { label: 'shortest lead time', brief: 'Meet demand with the shortest lead time from receiving to shipping.', w: { unit: 0.2, lead: 0.7, build: 0.1 } },
  build: { label: 'lowest build cost', brief: 'Meet demand at the lowest build cost (equipment plus power and water runs).', w: { unit: 0.25, lead: 0.15, build: 0.6 } },
};

/** Lower is better. Missing demand costs far more than any saving elsewhere. */
function scorer(goal: Goal, start: Metrics, demand: number) {
  const { w } = GOALS[goal];
  return (m: Metrics) =>
    w.unit * (m.cost.costPerUnit / start.cost.costPerUnit) +
    w.lead * (m.sim.leadTimeSec.median / start.sim.leadTimeSec.median) +
    w.build * (m.cost.buildCost / start.cost.buildCost) +
    4 * Math.max(0, 1 - m.sim.unitsPerHour.median / demand - 0.02);
}

export interface Tried {
  name: string;
  reason: string;
  source: 'neon' | 'search';
  outcome: 'kept' | 'simulated' | 'gated out' | 'rejected';
  errors?: string[];
  gate?: number;
  deltas?: { uph: number; leadMin: number; costPerUnit: number; buildCost: number };
}

export interface Round {
  n: number;
  tried: Tried[];
  kept?: string;
  ms: number;
}

/** Stations without display fields, so prompts carry layout facts only. */
function lean(spec: FactorySpec): FactorySpec {
  return {
    ...spec,
    stations: spec.stations.map(({ name: _n, catalogId: _c, height: _h, shape: _s, modelUrl: _m, image: _i, listingUrl: _l, checkoutUrl: _k, ...s }) => s),
  };
}

const sign = (v: number, digits = 1) => `${v > 0 ? '+' : ''}${v.toFixed(digits)}`;

export async function improveToGoal(start: FactorySpec, goal: Goal, emit: Emit) {
  const t0 = Date.now();
  const first = evaluate(start);
  if (!first.ok) throw new Error('The current layout is not valid: ' + first.errors.map((e) => e.message).join('; '));
  const score = scorer(goal, first.metrics, start.demandPerHour);
  const deltasFrom = (m: Metrics) => {
    const rows = Object.fromEntries(compare(first.metrics, m).map((r) => [r.key, r.delta]));
    return { uph: rows.uph, leadMin: rows.lead, costPerUnit: rows.cpu, buildCost: rows.build };
  };

  let best = { spec: start, metrics: first.metrics, score: score(first.metrics) };
  const rounds: Round[] = [];
  const kept: { round: number; name: string; spec: FactorySpec }[] = [];
  const history: string[] = [];
  let explanation = '';
  let stopped = `reached the limit of ${MAX_ROUNDS} rounds`;

  const system = `You improve a factory layout toward one goal, over several rounds. Each round you get the current best FactorySpec, its simulated metrics, and what earlier rounds tried with the measured result of each. Propose ${PER_ROUND} different candidate changes, each a short list of edit ops with a one-line reason. Never describe a layout in prose.
Goal: ${GOALS[goal].brief} Throughput must not fall below demand.
Learn from the history: do not repeat a change that was rejected or made things worse; build on what was kept.
Levers: shorten forklift legs by putting consecutive steps near each other and near the right dock; shorten power and water runs; relieve the busiest resource. Adding a station or a forklift costs money every hour or up front, so use it only when the layout alone cannot meet demand.
Ops: move {id,x,y}; rotate {id,rot}; add {station}; remove {id}; moveDock {index,wall,offset}; setParam {path,value} (path: forklifts or stations.<id>.<field>). Set fields an op does not use to null. Do not change demandPerHour or costs.
${GEOMETRY_RULES}`;

  for (let n = 1; n <= MAX_ROUNDS; n++) {
    const roundStart = Date.now();
    const tried: Tried[] = [];
    const pool: { t: Tried; spec: FactorySpec; ops: EditOp[] }[] = [];

    // 1. propose
    emit({ stage: 'improve', actor: 'neon', title: `Round ${n}: Neon is proposing changes`, ms: 0, status: 'running' });
    let proposed: any[] = [];
    try {
      const res = await interact<any>({
        model: MODELS.neon,
        input: `Current best spec:\n${JSON.stringify(lean(best.spec))}\n\nSimulated metrics:\n${situation(best.spec, best.metrics)}\n\n${history.length ? `What has been tried so far:\n${history.join('\n')}` : 'Nothing has been tried yet.'}`,
        system,
        schema: proposalSchema,
        thinking: 'low',
      });
      proposed = Array.isArray(res.json?.candidates) ? res.json.candidates.slice(0, PER_ROUND) : [];
      if (n === 1) explanation = String(res.json?.explanation ?? '');

      // 2. validate
      for (const raw of proposed) {
        const t: Tried = { name: String(raw?.name ?? 'candidate'), reason: String(raw?.reason ?? ''), source: 'neon', outcome: 'rejected' };
        try {
          const ops = toOps(Array.isArray(raw?.ops) ? raw.ops : []);
          if (!ops.length) throw new Error('no ops');
          const next = applyOps(best.spec, ops);
          const errs = validate(next);
          if (errs.length) t.errors = errs.map((e) => e.message).slice(0, 3);
          else pool.push({ t, spec: next, ops });
        } catch (e) {
          t.errors = [(e as Error).message];
        }
        tried.push(t);
      }
      const rejected = tried.filter((t) => t.errors);
      emit({
        stage: 'improve',
        actor: 'neon',
        title: `Round ${n}: Neon proposed ${proposed.length}, ${pool.length} pass the layout rules`,
        detail: rejected.length ? `rejected: ${rejected.map((t) => `${t.name} (${t.errors![0]})`).join('; ')}` : pool.map((p) => p.t.name).join(', '),
        ms: res.ms,
        status: rejected.length ? 'retry' : 'ok',
      });
    } catch (e) {
      emit({ stage: 'improve', actor: 'neon', title: `Round ${n}: Neon's proposal failed`, detail: (e as Error).message, ms: Date.now() - roundStart, status: 'fail' });
    }

    // 3. gate: one Decisions call scores every valid candidate before any simulation
    if (pool.length > 1) {
      emit({ stage: 'improve', actor: 'decisions', title: `Round ${n}: gating candidates before simulation`, ms: 0, status: 'running' });
      try {
        const questions: Record<string, Question> = {};
        pool.forEach((p, i) => {
          questions[`c${i}`] = {
            type: 'score',
            instructions: `Goal: ${GOALS[goal].brief} A proposed change to this factory layout: "${p.t.name}". Ops: ${JSON.stringify(p.ops)}. Reason given: ${p.t.reason}. How much is this change likely to help the goal without dropping throughput below demand?`,
            criteria: ['likely to make things worse', 'no real effect', 'small improvement', 'clear improvement', 'large improvement'],
          };
        });
        const g = await decide(`Factory layout spec:\n${JSON.stringify(lean(best.spec))}\n\nSimulated metrics:\n${situation(best.spec, best.metrics)}`, questions);
        pool.forEach((p, i) => {
          const a = g.answers[`c${i}`];
          if (a?.type === 'score') p.t.gate = a.score / 4;
        });
        const ranked = [...pool].sort((a, b) => (b.t.gate ?? 0) - (a.t.gate ?? 0));
        ranked.slice(KEEP_AFTER_GATE).forEach((p) => (p.t.outcome = 'gated out'));
        const cut = ranked.slice(KEEP_AFTER_GATE);
        emit({ stage: 'improve', actor: 'decisions', title: `Round ${n}: gate kept ${Math.min(KEEP_AFTER_GATE, pool.length)} of ${pool.length}`, detail: cut.length ? `cut: ${cut.map((p) => `${p.t.name} (${Math.round((p.t.gate ?? 0) * 100)}%)`).join(', ')}` : undefined, ms: g.ms, status: 'ok' });
      } catch (e) {
        emit({ stage: 'improve', actor: 'decisions', title: `Round ${n}: gate failed, simulating everything`, detail: (e as Error).message, ms: 0, status: 'fail' });
      }
    }

    // 4. the search's own candidate, on the same goal
    emit({ stage: 'improve', actor: 'engine', title: `Round ${n}: searching and simulating`, ms: 0, status: 'running' });
    const simStart = Date.now();
    try {
      const baseScore = best.score;
      const s = localSearch(best.spec, { iters: 160, seed: n, score: (_b, m) => score(m) });
      if (s.ops.length && s.score < baseScore) pool.push({ t: { name: `Search, seed ${n}`, reason: `Seeded search: ${s.accepted} accepted moves out of ${s.valid} legal ones tried.`, source: 'search', outcome: 'rejected' }, spec: s.spec, ops: s.ops });
      if (s.ops.length && s.score < baseScore) tried.push(pool[pool.length - 1].t);
    } catch {
      /* the search is a bonus; the round stands without it */
    }

    // 5. simulate what passed the gate, in parallel
    const scored = (
      await Promise.all(
        pool
          .filter((p) => p.t.outcome !== 'gated out')
          .map(async (p) => {
            const ev = evaluate(p.spec);
            if (!ev.ok) {
              p.t.errors = ev.errors.map((e) => e.message).slice(0, 3);
              return null;
            }
            p.t.outcome = 'simulated';
            p.t.deltas = deltasFrom(ev.metrics);
            return { ...p, metrics: ev.metrics, score: score(ev.metrics) };
          }),
      )
    ).filter((x): x is NonNullable<typeof x> => !!x);
    scored.sort((a, b) => a.score - b.score);
    const winner = scored[0];
    const improved = winner && winner.score < best.score * 0.997;

    // 6. keep or stop
    for (const t of tried) {
      const what = t.outcome === 'rejected' ? `rejected by layout rules: ${(t.errors ?? []).join('; ')}` : t.outcome === 'gated out' ? 'not simulated (low pre-check score)' : `simulated: lead ${sign(t.deltas!.leadMin)} min, cost/unit ${sign(t.deltas!.costPerUnit, 2)}, build ${sign(t.deltas!.buildCost, 0)}, units/h ${sign(t.deltas!.uph)} vs the starting layout`;
      history.push(`Round ${n} "${t.name}" [${t.source}]: ${what}${improved && winner.t === t ? ' -> KEPT as the new best' : ''}`);
    }
    if (improved) {
      winner.t.outcome = 'kept';
      best = { spec: winner.spec, metrics: winner.metrics, score: winner.score };
      kept.push({ round: n, name: winner.t.name, spec: winner.spec });
      const d = winner.t.deltas!;
      emit({ stage: 'improve', actor: 'engine', title: `Round ${n}: kept “${winner.t.name}”`, detail: `vs the start: lead ${sign(d.leadMin)} min, cost per unit ${sign(d.costPerUnit, 2)}, build ${sign(d.buildCost, 0)}, ${sign(d.uph)} units/h`, ms: Date.now() - simStart, status: 'ok' });
    } else {
      emit({ stage: 'improve', actor: 'engine', title: `Round ${n}: nothing beat the current layout`, detail: scored.length ? `best of ${scored.length} simulated was “${winner.t.name}”` : 'no candidate reached the simulator', ms: Date.now() - simStart, status: 'ok' });
    }
    rounds.push({ n, tried, kept: improved ? winner.t.name : undefined, ms: Date.now() - roundStart });
    if (!improved) {
      stopped = `round ${n} found nothing better`;
      break;
    }
  }

  return {
    goal,
    goalLabel: GOALS[goal].label,
    explanation,
    rounds,
    kept,
    ops: opsBetween(start, best.spec),
    deltas: deltasFrom(best.metrics),
    meetsDemand: best.metrics.sim.unitsPerHour.median >= start.demandPerHour * 0.98,
    stopped,
    ms: Date.now() - t0,
  };
}

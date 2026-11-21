// Server-side orchestration for the 5 Devil's Advocate agents, Surgical Fixer (Elena Vasquez),
// and Gemini 3.8 TTS voice synthesis for 3D floor characters.

import type {
  AdvocateFinding,
  AdvocateReport,
  AdvocateRole,
  AdvocateVerdict,
  CharacterRole,
  Emit,
  FixProposal,
  MetricDeltas,
  Requirements,
} from '../src/contracts';
import {
  ADVOCATE_CHARACTERS,
  ADVOCATE_ROLES,
  buildDeterministicFixCandidates,
  computeCharacterWalkPlans,
  runDeterministicAdvocateAudit,
} from '../src/engines/advocate';
import { validate } from '../src/engines/validate';
import { compare, evaluate, type Metrics } from '../src/engines/versions';
import { applyOps, leanSpec as lean, type EditOp, type FactorySpec } from '../src/spec';
import { decide, interact, MODELS, speakText, type Question } from './gemini';
import { proposalSchema, situation } from './optimize';
import { GEOMETRY_RULES, toOps } from './pipeline';

function deltasBetween(a: Metrics, b: Metrics): MetricDeltas {
  const rows = Object.fromEntries(compare(a, b).map((r) => [r.key, r.delta]));
  return { uph: rows.uph, leadMin: rows.lead, costPerUnit: rows.cpu, buildCost: rows.build };
}

const refinementSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    spokenRewrites: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          findingId: { type: 'string' },
          spokenLine: { type: 'string' },
          suggestedFixHint: { type: 'string' },
        },
        required: ['findingId', 'spokenLine', 'suggestedFixHint'],
      },
    },
  },
  required: ['summary', 'spokenRewrites'],
};

export interface AuditOptions {
  /** Fast mode inside the Improve loop: deterministic probes + batched Decisions gate (skips extra prose call) */
  fastGate?: boolean;
}

/**
 * Run the 5-Agent Devil's Advocate Review:
 * 1. Deterministic floor, +20% surge, wall-pinch, corridor-choke, unit-econ & maintenance probes
 * 2. One batched Gemini Decisions API (`gemini-decision-1`) call scoring all 5 specialist dimensions
 * 3. Optional `gemini-4-neon` refinement of spoken floor critiques (for full on-demand audits)
 */
export async function runAdvocateAudit(
  spec: FactorySpec,
  emit: Emit,
  requirements?: Requirements,
  opts: AuditOptions = {},
): Promise<AdvocateReport> {
  const t0 = Date.now();
  const ev = evaluate(spec, opts.fastGate ? 15 : 25);
  if (!ev.ok) {
    throw new Error('Cannot audit an invalid layout: ' + ev.errors.map((e) => e.message).join('; '));
  }

  emit({
    stage: 'advocate',
    actor: 'advocate',
    title: opts.fastGate ? 'Devil’s Advocate panel gating candidate' : '5 Devil’s Advocate inspectors walking the floor',
    ms: 0,
    status: 'running',
  });

  const det = runDeterministicAdvocateAudit(spec, ev.metrics, ev.routes, requirements);
  const findings: AdvocateFinding[] = structuredClone(det.findings);
  const agentVerdicts = structuredClone(det.agentVerdicts);

  // Calibrated 5-agent risk scoring via Gemini Decisions API (one batched call)
  const decisionContext = [
    `FactorySpec:\n${JSON.stringify(lean(spec))}`,
    `Simulated metrics:\n${situation(spec, ev.metrics)}`,
    requirements ? `Client brief requirements:\n${JSON.stringify({ name: requirements.name, floor: requirements.floor, demandPerHour: requirements.demandPerHour, steps: requirements.steps.map((s) => `${s.type}x${s.count}`) })}` : '',
    `Deterministic inspection probes:\n${findings.map((f) => `[${f.role.toUpperCase()} ${f.severity}] ${f.title}: ${f.evidence}`).join('\n') || 'None'}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const questions: Record<string, Question> = {
    stress: {
      type: 'score',
      instructions: 'As Marcus Cole (Stress & Bottleneck Breaker), rate the operational collapse risk of this factory layout under normal and +20% surge demand.',
      criteria: ['rock solid', 'minor strain', 'moderate bottleneck risk', 'high surge collapse risk', 'critical blocker — fails demand'],
    },
    safety: {
      type: 'score',
      instructions: 'As Nadia Okafor (Safety & Floor Flow Auditor), rate the EHS / floor-flow hazard risk (wall pinches, crossing forklift lanes, exposed long utility runs).',
      criteria: ['clean egress', 'minor congestion', 'moderate flow hazard', 'unsafe pinch or choke', 'critical safety veto'],
    },
    cfo: {
      type: 'score',
      instructions: 'As Victor Chen (CFO & Unit-Economics Critic), rate the capital waste and unit-economics inefficiency (idle machines, excess forklifts, high utility build overhead).',
      criteria: ['lean CapEx', 'acceptable spend', 'moderate waste', 'material CapEx/opex bloat', 'unacceptable unit economics'],
    },
    compliance: {
      type: 'score',
      instructions: 'As Priya Nair (Brief & Requirements Compliance Checker), rate how badly this layout drifts from client brief steps, demand target, or sequential flow.',
      criteria: ['fully compliant', 'minor alignment issue', 'noticeable backtracking', 'significant brief drift', 'fails mandatory brief requirement'],
    },
    maintenance: {
      type: 'score',
      instructions: 'As Hank Kowalski (Maintenance & Downtime Skeptic), rate the maintenance trap and single-point-of-failure downtime risk (boxed-in machines, zero backup on busy stages).',
      criteria: ['easy service access', 'minor tightness', 'moderate downtime risk', 'cramped or zero-redundancy trap', 'unserviceable critical blocker'],
    },
  };

  let decisionFailed = false;
  try {
    const dec = await decide(decisionContext, questions);
    for (const av of agentVerdicts) {
      const ans = dec.answers[av.role];
      if (ans?.type === 'score') {
        const risk = ans.score / 4;
        av.decisionScore = risk;
        for (const f of findings) {
          if (f.role === av.role) f.decisionConfidence = risk;
        }
        // Only escalate to warning if Decisions flags high risk (>= 0.75) and deterministic had none
        if (risk >= 0.78 && av.verdict === 'pass') {
          av.verdict = 'warn';
        }
      }
    }
    emit({
      stage: 'advocate',
      actor: 'decisions',
      title: `Decisions API scored all 5 specialist audits`,
      detail: agentVerdicts
        .map((a) => `${ADVOCATE_CHARACTERS[a.role].name.split(' ')[0]} ${a.decisionScore !== undefined ? `${Math.round(a.decisionScore * 100)}% risk` : a.verdict}`)
        .join(' · '),
      ms: dec.ms,
      status: 'ok',
    });
  } catch (e) {
    decisionFailed = true;
    emit({
      stage: 'advocate',
      actor: 'decisions',
      title: 'Decisions API risk calibration unavailable',
      detail: (e as Error).message,
      ms: 0,
      status: 'fail',
    });
    if (!opts.fastGate) throw e;
  }

  // On full on-demand audits, ask Neon to sharpen the characters' spoken floor lines
  let summary = det.summary;
  if (!opts.fastGate && findings.length > 0 && !decisionFailed) {
    emit({ stage: 'advocate', actor: 'neon', title: 'Refining floor inspector briefings', ms: 0, status: 'running' });
    try {
      const res = await interact<{ summary?: string; spokenRewrites?: { findingId: string; spokenLine: string; suggestedFixHint: string }[] }>({
        model: MODELS.neon,
        thinking: 'low',
        schema: refinementSchema,
        system: `You voice 5 realistic factory-floor devil's advocate inspectors standing beside specific machines. Rewrite each finding's spokenLine into a crisp, vivid 1-2 sentence first-person remark (under 28 words) naming the exact machine ID and grounded metric. Never invent numbers that are not in the input.`,
        input: `Findings to sharpen:\n${JSON.stringify(
          findings.map((f) => ({
            findingId: f.id,
            speaker: `${ADVOCATE_CHARACTERS[f.role].name} (${ADVOCATE_CHARACTERS[f.role].title})`,
            severity: f.severity,
            title: f.title,
            evidence: f.evidence,
            targetIds: f.targetIds,
            currentSpokenLine: f.spokenLine,
          })),
        )}`,
      });
      if (res.json?.summary) summary = res.json.summary;
      const byId = new Map((res.json?.spokenRewrites ?? []).map((r) => [r.findingId, r]));
      for (const f of findings) {
        const rw = byId.get(f.id);
        if (rw?.spokenLine && rw.spokenLine.trim().length > 10) {
          f.spokenLine = rw.spokenLine.trim();
          f.source = 'gemini';
        }
        if (rw?.suggestedFixHint && rw.suggestedFixHint.trim().length > 6) {
          f.suggestedFixHint = rw.suggestedFixHint.trim();
        }
      }
      emit({
        stage: 'advocate',
        actor: 'neon',
        title: `5 inspectors briefed ${findings.length} finding${findings.length === 1 ? '' : 's'}`,
        detail: summary,
        ms: res.ms,
        status: 'ok',
      });
    } catch (e) {
      emit({
        stage: 'advocate',
        actor: 'neon',
        title: 'Using deterministic floor briefings',
        detail: (e as Error).message,
        ms: 0,
        status: 'retry',
      });
    }
  }

  const blockerCount = findings.filter((f) => f.severity === 'blocker').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;
  const advisoryCount = findings.filter((f) => f.severity === 'advisory').length;
  const verdict: AdvocateVerdict = blockerCount > 0 ? 'veto' : warningCount > 0 ? 'warn' : 'pass';
  const walkPlans = computeCharacterWalkPlans(spec, findings);

  emit({
    stage: 'advocate',
    actor: 'advocate',
    title:
      verdict === 'veto'
        ? `Panel vetoed: ${blockerCount} blocker${blockerCount > 1 ? 's' : ''}, ${warningCount} warning${warningCount === 1 ? '' : 's'}`
        : verdict === 'warn'
          ? `Panel flagged ${warningCount} warning${warningCount === 1 ? '' : 's'} (0 blockers)`
          : 'Panel cleared layout with 0 blockers',
    detail: findings.slice(0, 2).map((f) => `${ADVOCATE_CHARACTERS[f.role].name.split(' ')[0]}: ${f.title}`).join(' · ') || summary,
    ms: Date.now() - t0,
    status: verdict === 'veto' ? 'fail' : 'ok',
  });

  return {
    verdict,
    summary,
    blockerCount,
    warningCount,
    advisoryCount,
    findings,
    agentVerdicts,
    walkPlans,
    ms: Date.now() - t0,
    mode: 'full',
  };
}

/**
 * Surgical Fixer (Elena Vasquez):
 * Proposes rule-validated EditOp[] patches for the selected findings (or all findings),
 * evaluates both Neon candidates and deterministic fallbacks with the discrete-event simulator
 * and re-audits each candidate to verify exact issue reduction + metric deltas.
 */
export async function proposeAdvocateFix(
  spec: FactorySpec,
  targetFindings: AdvocateFinding[],
  emit: Emit,
  requirements?: Requirements,
): Promise<FixProposal> {
  const t0 = Date.now();
  const baseEval = evaluate(spec, 20);
  if (!baseEval.ok) throw new Error('Current layout is invalid: ' + baseEval.errors.map((e) => e.message).join('; '));
  const baseAudit = runDeterministicAdvocateAudit(spec, baseEval.metrics, baseEval.routes, requirements);
  const targets = targetFindings.length ? targetFindings : baseAudit.findings.filter((f) => f.severity !== 'advisory');
  if (!targets.length) throw new Error('No open findings to fix on this layout.');

  emit({
    stage: 'fix',
    actor: 'fixer',
    title: `Elena Vasquez drafting fix for ${targets.length} finding${targets.length > 1 ? 's' : ''}`,
    ms: 0,
    status: 'running',
  });

  const pool: { label: string; reason: string; ops: EditOp[]; spec: FactorySpec; source: 'neon' | 'deterministic' }[] = [];

  // 1. Ask Gemini 4 Neon for surgical EditOp[] repair candidates
  try {
    const res = await interact<any>({
      model: MODELS.neon,
      thinking: 'low',
      schema: proposalSchema,
      system: `You are Elena Vasquez, a surgical industrial layout fixer. Given a valid FactorySpec, its metrics, and specific Devil's Advocate findings, propose up to 3 concrete, rule-valid candidate patches (each a minimal list of EditOps) that resolve those exact findings without dropping throughput below demand or creating new outer-wall pinch gaps (keep stations either flush at 0 m against a wall or >= 1.5 m clear of outer walls).
Ops: move {id,x,y}; rotate {id,rot}; add {station}; remove {id}; moveDock {index,wall,offset}; setParam {path,value} (path: forklifts or stations.<id>.<field>). Set unused op fields to null. Do not lower demandPerHour.
${GEOMETRY_RULES}`,
      input: `Current FactorySpec:\n${JSON.stringify(lean(spec))}\n\nCurrent metrics:\n${situation(spec, baseEval.metrics)}\n\nTarget Devil's Advocate findings to resolve:\n${JSON.stringify(
        targets.map((f) => ({
          id: f.id,
          role: f.role,
          severity: f.severity,
          title: f.title,
          evidence: f.evidence,
          targetIds: f.targetIds,
          suggestedFixHint: f.suggestedFixHint,
        })),
      )}`,
    });

    const rawCandidates = Array.isArray(res.json?.candidates) ? res.json.candidates.slice(0, 3) : [];
    for (const raw of rawCandidates) {
      try {
        const ops = toOps(Array.isArray(raw?.ops) ? raw.ops : []);
        if (!ops.length) continue;
        const next = applyOps(spec, ops);
        if (validate(next).length === 0) {
          pool.push({
            label: String(raw?.name ?? 'Surgical layout fix'),
            reason: String(raw?.reason ?? 'Resolved flagged floor defects'),
            ops,
            spec: next,
            source: 'neon',
          });
        }
      } catch {
        /* ignore invalid op attempt */
      }
    }
    emit({
      stage: 'fix',
      actor: 'neon',
      title: `Neon drafted ${rawCandidates.length} fix candidate${rawCandidates.length === 1 ? '' : 's'} (${pool.length} rule-valid)`,
      ms: res.ms,
      status: pool.length ? 'ok' : 'retry',
    });
  } catch (e) {
    emit({
      stage: 'fix',
      actor: 'neon',
      title: 'Neon fix proposal failed; testing deterministic repairs',
      detail: (e as Error).message,
      ms: 0,
      status: 'retry',
    });
  }

  // 2. Compete with deterministic rule-validated fixes
  for (const det of buildDeterministicFixCandidates(spec, targets)) {
    pool.push({ label: det.label, reason: det.label, ops: det.ops, spec: det.spec, source: 'deterministic' });
  }

  if (!pool.length) {
    throw new Error('Could not find a rule-valid fix that fits within the current floor geometry. Try freeing floor space or adjusting floor dimensions.');
  }

  // 3. Simulate & re-audit every candidate to rank by resolved issues + metrics
  emit({ stage: 'fix', actor: 'engine', title: `Simulating and re-auditing ${pool.length} fix candidate${pool.length === 1 ? '' : 's'}`, ms: 0, status: 'running' });
  const targetIdSet = new Set(targets.map((f) => f.id));
  const scored: {
    cand: (typeof pool)[number];
    deltas: MetricDeltas;
    postAudit: AdvocateReport;
    resolvedCount: number;
    score: number;
  }[] = [];

  for (const cand of pool) {
    const ev = evaluate(cand.spec, 20);
    if (!ev.ok) continue;
    const postAudit = runDeterministicAdvocateAudit(cand.spec, ev.metrics, ev.routes, requirements);
    const remainingTargetIds = new Set(postAudit.findings.map((f) => f.id));
    let resolvedTargetCount = 0;
    for (const id of targetIdSet) {
      if (!remainingTargetIds.has(id)) resolvedTargetCount++;
    }
    const totalReduction = Math.max(0, baseAudit.findings.length - postAudit.findings.length);
    const resolvedCount = Math.max(resolvedTargetCount, totalReduction);
    const deltas = deltasBetween(baseEval.metrics, ev.metrics);
    const demandPenalty = Math.max(0, 1 - ev.metrics.sim.unitsPerHour.median / spec.demandPerHour - 0.02) * 50;
    // Lower score is better: strongly prioritize cutting blockers, resolving targets, then improving lead/cost
    const score =
      postAudit.blockerCount * 15 +
      postAudit.warningCount * 4 -
      resolvedTargetCount * 10 +
      demandPenalty +
      (ev.metrics.cost.costPerUnit / Math.max(0.01, baseEval.metrics.cost.costPerUnit)) * 1.5 +
      (ev.metrics.sim.leadTimeSec.median / Math.max(1, baseEval.metrics.sim.leadTimeSec.median));
    scored.push({ cand, deltas, postAudit, resolvedCount, score });
  }

  scored.sort((a, b) => a.score - b.score);
  const best = scored[0];
  if (!best) throw new Error('All fix candidates failed simulation validation.');

  // Include Elena Vasquez in postAudit walkPlans pointing at the edited station(s)
  const touchedIds = best.cand.ops
    .map((o) => ('id' in o ? o.id : o.op === 'add' ? o.station.id : null))
    .filter((x): x is string => Boolean(x));
  const fallbackIds = targets.flatMap((t) => t.targetIds);
  best.postAudit.walkPlans = computeCharacterWalkPlans(best.cand.spec, best.postAudit.findings, touchedIds.length ? touchedIds : fallbackIds);

  const opCount = best.cand.ops.length;
  const article = [8, 11, 18].includes(opCount) ? 'an' : 'a';
  const buildStr =
    Math.abs(best.deltas.buildCost) >= 25
      ? `${best.deltas.buildCost < 0 ? 'cuts' : 'adds'} $${Math.round(Math.abs(best.deltas.buildCost)).toLocaleString()} in build cost`
      : '';
  const leadStr =
    Math.abs(best.deltas.leadMin) >= 0.1
      ? `${best.deltas.leadMin < 0 ? 'cuts' : 'adds'} ${Math.abs(best.deltas.leadMin).toFixed(1)} minutes of lead time`
      : 'holds lead time steady';
  const costStr =
    Math.abs(best.deltas.costPerUnit) >= 0.01
      ? `${best.deltas.costPerUnit < 0 ? 'saves' : 'adds'} $${Math.abs(best.deltas.costPerUnit).toFixed(2)} per unit`
      : 'keeps unit cost flat';
  const resolveClause =
    best.resolvedCount > 0
      ? `clears ${best.resolvedCount} flagged issue${best.resolvedCount === 1 ? '' : 's'}`
      : buildStr || 'tightens the floor geometry';

  const spokenSummary = `I simulated ${article} ${opCount}-step fix: ${best.cand.label}. It ${resolveClause}, ${buildStr && best.resolvedCount > 0 ? `${buildStr}, ` : ''}${leadStr}, and ${costStr}. Click apply when you want me to save it.`;

  emit({
    stage: 'fix',
    actor: 'fixer',
    title: `Elena Vasquez verified fix: ${best.cand.label}`,
    detail: `Resolved ${best.resolvedCount} issue${best.resolvedCount === 1 ? '' : 's'} · ${best.postAudit.blockerCount} blocker${best.postAudit.blockerCount === 1 ? '' : 's'} left`,
    ms: Date.now() - t0,
    status: 'ok',
  });

  return {
    id: `fix-${Date.now()}`,
    targetFindingIds: targets.map((f) => f.id),
    summary: `${best.cand.label}${best.cand.reason && best.cand.reason !== best.cand.label ? ` — ${best.cand.reason}` : ''}`,
    spokenSummary,
    ops: best.cand.ops,
    spec: best.cand.spec,
    deltas: best.deltas,
    resolvedCount: best.resolvedCount,
    remainingBlockers: best.postAudit.blockerCount,
    remainingWarnings: best.postAudit.warningCount,
    postAudit: best.postAudit,
    source: best.cand.source,
    ms: Date.now() - t0,
  };
}

/** Synthesize WAV speech for one of the 6 floor characters using Gemini 3.8 Flash-Lite TTS. */
export async function synthesizeAdvocateSpeech(role: CharacterRole, text: string) {
  const char = ADVOCATE_CHARACTERS[role] ?? ADVOCATE_CHARACTERS.stress;
  return speakText({ text, voice: char.voice, style: char.style });
}

export function isCharacterRole(x: unknown): x is CharacterRole {
  return typeof x === 'string' && (x === 'fixer' || ADVOCATE_ROLES.includes(x as AdvocateRole));
}

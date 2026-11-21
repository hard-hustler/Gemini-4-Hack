// The eval crew: five technician agents that inspect a design, the checker that filters what they
// write, the layout fixer, and speech for the floor characters.

import type { AdvocateFinding, AdvocateReport, AdvocateRole, CharacterRole, Emit, FindingFix, FixProposal, MetricDeltas, Requirements } from '../src/contracts';
import {
  ADVOCATE_CHARACTERS,
  ADVOCATE_ROLES,
  buildDeterministicFixCandidates,
  buildReport,
  computeCharacterWalkPlans,
  crewStartTargets,
  runDeterministicAdvocateAudit,
} from '../src/engines/advocate';
import { alreadyOnFloor, checkCites, FACT_KINDS, MACHINE_FACTS, PLANT_FACTS, plantFacts, type Cite, type FactKind } from '../src/engines/facts';
import type { Routes } from '../src/engines/route';
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

export interface AuditOptions {
  /** inside the improve loop: only what the engines measure, no model calls */
  fastGate?: boolean;
}

const MAX_PER_TECHNICIAN = 4;
const MAX_BLOCKERS = 2;
/** below this the checker thinks a finding is generic advice, and it is dropped */
export const KEEP_AT = 0.5;

/** The one question the checker is asked about a finding. Exported so the checker itself can be tested. */
export const checkerQuestion = (about: string, finding: string): Question => ({
  type: 'noul',
  instructions: `The input is the data sheet of a factory design. A reviewer wrote this finding about ${about}: "${finding}" Is this a specific defect of this particular design, naming a real machine or a missing item and giving a concrete reason that can be checked, rather than generic advice that would be true of any factory?`,
});

/** What each technician looks at. The prompt is the trade, not a personality. */
const TRADES: Record<AdvocateRole, { doing: string; scope: string; examples: string }> = {
  process: {
    doing: 'checking rates, handling and machine fit',
    scope:
      'whether each machine suits the job it is given and the machines around it: rate match between consecutive steps, part size and weight against the machine envelope and capacity, how parts are held and moved between machines, buffers where a fast step feeds a slow one, batch machines on a one-piece flow, changeover, where quality is checked relative to where defects are made.',
    examples:
      '"deburr1: a 0.5 cubic foot vibratory bowl holds about 15 housings a load on a 30 minute cycle, 30 an hour, against 60 an hour needed. Replace both with 2 cubic foot bowls." / "saw1: bar stock is 3 m long but the belt feeding saw1 is 0.4 m wide. Feed the saw from a roller rack, not the belt."',
  },
  safety: {
    doing: 'checking guarding, exposure, fire and escape',
    scope:
      'guarding and interlocks on each machine, emergency stops within reach, pinch and crush points at conveyors and transfers, operator exposure to coolant mist, dust, fume and noise, fire load (metal fines, solvents, oil), eye-wash and first aid where chemicals are handled, lockout points, pedestrian routes against conveyors and vehicles, travel distance to an exit.',
    examples:
      '"mill4: aluminium fines from eleven mills collect dry in the chip trays. Aluminium dust is explosive. Fit a wet collector, not a dry one." / "wash1: operators handle alkaline cleaner at 60 C with no eye-wash within 10 m. Add a plumbed eye-wash station beside it."',
  },
  electrical: {
    doing: 'checking supply, protection and backup power',
    scope:
      'supply voltage and phase each machine needs, total connected load against the service, feeder and breaker sizing, cable run length and voltage drop, starting current of large motors, backup power for controls that lose position or data on a power cut (CNC controls, CMMs, PLCs), earthing and bonding, emergency power off, power quality for measuring equipment.',
    examples:
      '"lathe3: a 15 kW spindle on 400 V three-phase draws about 27 A running and several times that starting, at the end of a 38 m run. Size the feeder for 40 A and check volt drop under 3%." / "plant: 210 kW connected with no backup supply; a power cut mid-cycle scraps the part in every spindle and loses CMM position. Add a UPS for the CNC and CMM controls."',
  },
  utilities: {
    doing: 'checking water, drains, coolant, air and extraction',
    scope:
      'water supply and drainage to each machine that needs it, coolant mixing, sump capacity and coolant disposal, oil and coolant leaks and how they are contained (bunds, drip trays, oil-water separator before drain), compressed air demand of each machine and whether a compressor and dryer exist for it, dust, mist and fume extraction sized in cubic metres an hour against the machine, temperature control where measurement needs it.',
    examples:
      '"mill1: eleven enclosed mills each need about 150 l/min of dry air at 6 bar for tool change and no compressor is on the floor. Add a 30 kW screw compressor with dryer." / "lathe2: way oil and coolant leak past the chip conveyor seal on this type of lathe and there is no containment under it. Add a bunded drip tray drained to an oil-water separator."',
  },
  machines: {
    doing: 'checking installation, access and upkeep',
    scope:
      'floor loading and foundations under heavy machines, service clearance for doors, electrical cabinets, chip conveyors, bar feeders and tool magazines, vibration reaching measuring machines, chip and swarf removal, lubrication and coolant top-up access, wear parts and spares, whether one machine going down stops the line, how a machine is craned or skated in and out.',
    examples:
      '"cmm1: a bridge CMM 4 m from five CNC lathes will read their vibration through the slab. Move it at least 10 m away or put it on an isolated plinth." / "mill6: the rear electrical cabinet opens toward mill11 with 1.2 m between them; the door needs 0.9 m and a technician cannot stand behind it. Open the gap to 1.8 m."',
  },
};

const technicianSystem = (role: AdvocateRole) => `You are a senior ${ADVOCATE_CHARACTERS[role].title.toLowerCase()} with twenty years on factory floors, doing a pre-build design review. You are ${TRADES[role].doing}.

Your scope: ${TRADES[role].scope}

How you write:
- Go machine by machine through the sheet. Report only what is wrong with THIS design. Say nothing about a machine you have no finding for.
- Every finding names one machine by its id from the sheet, or "plant" when something the whole plant needs is missing.
- "problem" is one sentence of at most 22 words: the defect and the fact that makes it one. Use a number from the sheet, or a known property of that make or kind of machine. Give the number.
- "action" is one imperative sentence of at most 16 words that a contractor could act on, with a size, rating or distance.
- "title" is at most 6 words: the thing and what is wrong with it. No machine id in the title.
- "cites" lists every number from the sheet that the finding rests on, as machine, fact and value. Code checks each one against the plant and throws out a finding that misquotes it, so copy the number exactly. Numbers you know from experience (a current, a voltage, an airflow) are not cites. Machine facts: ${MACHINE_FACTS.join(", ")}. Plant facts (machine "plant"): ${PLANT_FACTS.join(", ")}.
- No general advice, no praise, no restating the brief, no "consider", "ensure", "it is recommended", "may" or "could". If you would write the same sentence about any factory, do not write it.
- Do not repeat anything listed under "Already measured". Do not invent machine ids.
- Stay in your trade. Four other technicians are reviewing the same sheet: ${ADVOCATE_ROLES.filter((r) => r !== role)
  .map((r) => ADVOCATE_CHARACTERS[r].title.toLowerCase())
  .join(', ')}. Leave compressed air, water, drains, coolant and extraction to plumbing and air; supply and protection to electrical; guarding, exposure and fire to safety; installation, clearance and upkeep to machines; rates and machine fit to process. If it is another trade's call, do not write it.
- If the fix is a floor-standing unit that is missing from the sheet (a dust collector, compressor, generator, UPS cabinet, chiller, eye-wash station, separator), set fixBy to "add_equipment" and describe that unit with a realistic footprint, power and installed price. Only for a unit that is absent: replacing or upgrading a machine that is already on the sheet is a "design_change". If the fix is moving or re-spacing a machine, set fixBy to "move_machine". Otherwise "design_change".
- severity: most findings are "warning": it will cost downtime, scrap, rework or a failed inspection. Use "blocker" only when production cannot start as drawn or someone will be hurt, and for at most two findings. Use "advisory" for an improvement that can wait.
- At most ${MAX_PER_TECHNICIAN} findings, worst first. Fewer is fine. None is fine.

The kind of finding wanted (these are from another plant; do not copy them): ${TRADES[role].examples}`;

const technicianSchema = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          targetId: { type: 'string', description: 'a machine id exactly as in the sheet, or "plant"' },
          title: { type: 'string', description: 'at most 6 words: the thing and what is wrong with it' },
          problem: { type: 'string', description: 'one sentence, at most 22 words: the defect and the number or fact behind it' },
          severity: { type: 'string', enum: ['blocker', 'warning', 'advisory'] },
          action: { type: 'string', description: 'one imperative sentence, at most 16 words, with a size, rating or distance' },
          cites: {
            type: 'array',
            description: 'every sheet number this finding rests on; empty if it rests on none',
            items: {
              type: 'object',
              properties: { machine: { type: 'string', description: 'a machine id, or "plant"' }, fact: { type: 'string', enum: [...FACT_KINDS] }, value: { type: 'number' } },
              required: ['machine', 'fact', 'value'],
            },
          },
          fixBy: { type: 'string', enum: ['add_equipment', 'move_machine', 'design_change'] },
          equipmentName: { type: 'string', description: 'the unit to add, e.g. "Wet dust collector"; empty unless fixBy is add_equipment' },
          equipmentW: { type: 'number', description: 'footprint width in metres; 0 if none' },
          equipmentD: { type: 'number', description: 'footprint depth in metres; 0 if none' },
          equipmentH: { type: 'number', description: 'height in metres; 0 if none' },
          equipmentKw: { type: 'number', description: 'power draw in kW; 0 if none' },
          equipmentNeedsWater: { type: 'boolean' },
          equipmentPrice: { type: 'number', description: 'installed price in US dollars; 0 if none' },
        },
        required: ['targetId', 'title', 'problem', 'severity', 'action', 'cites', 'fixBy', 'equipmentName', 'equipmentW', 'equipmentD', 'equipmentH', 'equipmentKw', 'equipmentNeedsWater', 'equipmentPrice'],
      },
    },
  },
  required: ['findings'],
};

/** Everything a technician is given: the plant, its utilities, and one line per machine with the facts that matter. */
export function plantSheet(spec: FactorySpec, metrics: Metrics, routes: Routes, requirements?: Requirements): string {
  const facts = plantFacts(spec, metrics, routes);
  const labels = new Map((requirements?.steps ?? []).map((s) => [s.type, s.label]));
  const inFlow = new Set(spec.routing);
  const line = (s: FactorySpec['stations'][number]) => {
    const f = facts.machines.get(s.id) ?? {};
    const near = facts.nearest.get(s.id);
    return [
      s.id,
      labels.get(s.type) ?? s.type,
      s.name ?? s.type,
      `${s.w} x ${s.d}${s.height ? ` x ${s.height}` : ''} m`,
      s.powerKw ? `${s.powerKw} kW${f.supply_run_m !== undefined ? `, ${f.supply_run_m.toFixed(0)} m from the supply` : ''}` : 'no power',
      s.needsWater ? `water${f.water_run_m !== undefined ? `, ${f.water_run_m.toFixed(0)} m from the main` : ''}` : 'no water',
      inFlow.has(s.type) ? `${s.cycleTimeSec} s a part, ${f.busy_pct}% busy, ${s.operators} operator${s.operators === 1 ? '' : 's'}` : 'support equipment',
      near && f.nearest_gap_m !== undefined ? `${f.nearest_gap_m.toFixed(1)} m to ${near}` : '',
      `${(f.wall_gap_m ?? 0).toFixed(1)} m to the nearest wall`,
      s.zone ?? '',
    ]
      .filter(Boolean)
      .join(' | ');
  };
  const support = spec.stations.filter((s) => !inFlow.has(s.type));
  return [
    `PLANT: ${requirements?.name ?? spec.name ?? 'Factory'}. ${requirements?.summary ?? ''}`,
    `Floor ${spec.floor.width} x ${spec.floor.depth} m. Demand ${spec.demandPerHour} an hour; the simulator measures ${metrics.sim.unitsPerHour.median.toFixed(1)} an hour, bottleneck ${metrics.sim.bottleneck.name}. Lead time ${(metrics.sim.leadTimeSec.median / 60).toFixed(0)} min.`,
    `Parts move by ${spec.transport === 'conveyor' ? `belt conveyor, ${routes.totals.pathM.toFixed(0)} m of it` : `${spec.forklifts ?? 1} forklift(s)`}. Docks: ${spec.docks.map((d) => `${d.kind} on the ${d.wall} wall`).join(', ')}.`,
    `UTILITIES: electrical supply enters at (${spec.utilityEntry.power.x}, ${spec.utilityEntry.power.y}) m, water main at (${spec.utilityEntry.water.x}, ${spec.utilityEntry.water.y}) m. Connected load ${(facts.plant.connected_kw ?? 0).toFixed(0)} kW across ${spec.stations.filter((s) => s.powerKw > 0).length} machines. ${spec.stations.filter((s) => s.needsWater).length} machines take water.`,
    `SUPPORT EQUIPMENT ON THE FLOOR: ${support.length ? support.map((s) => s.name ?? s.type).join(', ') : 'none. No compressor, dust or mist collector, generator, UPS, chiller, separator or eye-wash is on the sheet.'}`,
    `MACHINES (id | step | make and model | footprint | power | water | duty | nearest machine | wall | department):`,
    ...spec.stations.map(line),
  ].join('\n');
}

interface RawFinding {
  targetId?: string;
  title?: string;
  problem?: string;
  severity?: string;
  action?: string;
  cites?: { machine?: string; fact?: string; value?: number }[];
  fixBy?: string;
  equipmentName?: string;
  equipmentW?: number;
  equipmentD?: number;
  equipmentH?: number;
  equipmentKw?: number;
  equipmentNeedsWater?: boolean;
  equipmentPrice?: number;
}

/** A technician's raw finding, checked in code: real machine, real text, sane equipment. */
type Written = AdvocateFinding & { cites: Cite[] };

function toFinding(role: AdvocateRole, raw: RawFinding, i: number, spec: FactorySpec): Written | null {
  const title = String(raw.title ?? '').trim();
  const problem = String(raw.problem ?? '').trim();
  const action = String(raw.action ?? '').trim();
  if (title.length < 6 || problem.length < 20 || action.length < 10) return null;
  const want = String(raw.targetId ?? '').trim();
  const station = spec.stations.find((s) => s.id === want);
  if (!station && want.toLowerCase() !== 'plant') return null;
  const severity = raw.severity === 'blocker' || raw.severity === 'warning' ? raw.severity : 'advisory';
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  const name = String(raw.equipmentName ?? '').trim();
  const fix: FindingFix =
    raw.fixBy === 'add_equipment' && name.length > 2 && n(raw.equipmentW) && n(raw.equipmentD)
      ? { kind: 'equipment', equipment: { name: name.slice(0, 60).replace(/\s+\S*$/, (m) => (name.length > 60 ? '' : m)), w: n(raw.equipmentW), d: n(raw.equipmentD), h: n(raw.equipmentH) || 1.5, powerKw: n(raw.equipmentKw), needsWater: !!raw.equipmentNeedsWater, price: n(raw.equipmentPrice) } }
      : raw.fixBy === 'move_machine' && station
        ? { kind: 'layout' }
        : { kind: 'spec' };
  return {
    id: `${role}-t${i + 1}-${station?.id ?? 'plant'}`,
    role,
    severity,
    title: title.slice(0, 90),
    evidence: problem,
    metricDeltaHint: fix.kind === 'equipment' && fix.equipment.price ? `$${Math.round(fix.equipment.price).toLocaleString()} installed` : '',
    targetIds: station ? [station.id] : [],
    suggestedFixHint: action,
    action,
    fix,
    spokenLine: `${title}. ${problem} ${action}`,
    source: 'gemini',
    cites: (Array.isArray(raw.cites) ? raw.cites : [])
      .filter((c) => typeof c?.machine === 'string' && typeof c?.value === 'number' && (FACT_KINDS as readonly string[]).includes(String(c?.fact)))
      .slice(0, 6)
      .map((c) => ({ machine: String(c.machine), fact: c.fact as FactKind, value: Number(c.value) })),
  };
}

/** Whose call each kind of missing equipment is, when two technicians ask for the same thing. */
const OWNER: [RegExp, AdvocateRole][] = [
  [/compress|air dryer|receiver/i, 'utilities'],
  [/collector|extract|scrubber|separator|chiller|coolant|drain|sump/i, 'utilities'],
  [/generator|ups|transformer|panel|switch/i, 'electrical'],
  [/eye.?wash|shower|guard|fenc|light curtain|extinguish/i, 'safety'],
];

/**
 * Two technicians asking for the same unit, or for the same machine to be moved, is one finding.
 * The trade that owns it keeps it; otherwise the more severe one does.
 */
function dedupe<T extends AdvocateFinding>(list: T[]): T[] {
  const rank = { blocker: 0, warning: 1, advisory: 2 } as const;
  const kept = new Map<string, T>();
  const out: T[] = [];
  for (const f of list) {
    let key: string | null = null;
    let owner: AdvocateRole | undefined;
    if (f.fix?.kind === 'equipment') {
      const hit = OWNER.find(([re]) => re.test(f.fix?.kind === 'equipment' ? f.fix.equipment.name : ''));
      // the same kind of unit for the same machine (or for the plant) is the same request
      key = hit ? `eq:${hit[0].source}:${f.targetIds[0] ?? 'plant'}` : null;
      owner = hit?.[1];
    } else if (f.fix?.kind === 'layout') {
      key = `move:${f.targetIds[0]}`;
      owner = 'machines';
    }
    if (!key) {
      out.push(f);
      continue;
    }
    const prev = kept.get(key);
    if (!prev) {
      kept.set(key, f);
      continue;
    }
    const better = f.role === owner && prev.role !== owner ? true : prev.role === owner && f.role !== owner ? false : rank[f.severity] < rank[prev.severity];
    if (better) kept.set(key, f);
  }
  return [...out, ...kept.values()];
}

/**
 * The eval crew. Five technician agents each inspect the plant sheet for their own trade and write
 * findings; the engines add what they measure; an independent checker (Decisions API) drops any
 * technician finding it judges to be generic advice rather than a defect of this design.
 * Each step is emitted with the crew member it belongs to, so the floor can show them at work.
 */
export async function runAdvocateAudit(spec: FactorySpec, emit: Emit, requirements?: Requirements, opts: AuditOptions = {}): Promise<AdvocateReport> {
  const t0 = Date.now();
  const ev = evaluate(spec, opts.fastGate ? 15 : 25);
  if (!ev.ok) throw new Error('Cannot evaluate an invalid layout: ' + ev.errors.map((e) => e.message).join('; '));
  const measured = runDeterministicAdvocateAudit(spec, ev.metrics, ev.routes, requirements);

  // inside the improve loop only the measured findings gate a candidate: fast, and nothing to argue with
  if (opts.fastGate) {
    emit({ stage: 'advocate', actor: 'engine', title: `Measured checks: ${measured.blockerCount} blocker${measured.blockerCount === 1 ? '' : 's'}, ${measured.warningCount} warning${measured.warningCount === 1 ? '' : 's'}`, ms: Date.now() - t0, status: measured.blockerCount ? 'fail' : 'ok' });
    return { ...measured, ms: Date.now() - t0 };
  }

  emit({ stage: 'advocate', actor: 'advocate', title: 'Five technicians inspecting the floor', ms: 0, status: 'running' });
  const sheet = plantSheet(spec, ev.metrics, ev.routes, requirements);
  const already = measured.findings.map((f) => `- ${f.targetIds.join(', ') || 'plant'}: ${f.title}`).join('\n') || '- nothing';

  const inspect = async (role: AdvocateRole): Promise<Written[]> => {
    const who = ADVOCATE_CHARACTERS[role];
    const started = Date.now();
    emit({ stage: 'advocate', actor: 'advocate', who: role, title: `${who.name} is ${TRADES[role].doing}`, ms: 0, status: 'running' });
    try {
      const res = await interact<{ findings?: RawFinding[] }>({
        model: MODELS.neon,
        thinking: 'low',
        maxOutputTokens: 6000,
        schema: technicianSchema,
        system: technicianSystem(role),
        input: `${sheet}\n\nAlready measured by the simulator (do not repeat):\n${already}\n\nWrite your findings.`,
      });
      const seen = new Set<string>();
      const out: Written[] = [];
      for (const raw of Array.isArray(res.json?.findings) ? res.json.findings : []) {
        const f = toFinding(role, raw, out.length, spec);
        // one finding per machine per technician: the second is usually the first reworded
        if (!f || seen.has(f.targetIds[0] ?? 'plant')) continue;
        seen.add(f.targetIds[0] ?? 'plant');
        out.push(f);
        if (out.length >= MAX_PER_TECHNICIAN) break;
      }
      emit({ stage: 'advocate', actor: 'neon', who: role, title: `${who.name} wrote ${out.length} finding${out.length === 1 ? '' : 's'}`, detail: out[0]?.title, ms: Date.now() - started, status: 'ok' });
      return out;
    } catch (e) {
      emit({ stage: 'advocate', actor: 'neon', who: role, title: `${who.name} could not finish the inspection`, detail: (e as Error).message, ms: Date.now() - started, status: 'fail' });
      return [];
    }
  };
  const drafted = dedupe((await Promise.all(ADVOCATE_ROLES.map(inspect))).flat()) as Written[];

  // Code first: a technician's judgement cannot be re-run, but the plant numbers it quotes can. A finding
  // that misquotes the layout, or asks for a unit that is already on the floor, is thrown out here.
  const facts = plantFacts(spec, ev.metrics, ev.routes);
  const written: AdvocateFinding[] = [];
  const thrown: string[] = [];
  let quoted = 0;
  for (const { cites, ...f } of drafted) {
    const check = checkCites(cites, facts);
    const have = f.fix?.kind === 'equipment' ? alreadyOnFloor(spec, f.fix.equipment.name) : null;
    if (check.wrong.length) {
      thrown.push(`${f.title}: ${check.wrong[0]}`);
      continue;
    }
    if (have) {
      thrown.push(`${f.title}: ${have} is already on the floor`);
      continue;
    }
    quoted += check.checked;
    // verified: every number it quotes is right, or the unit it says is missing really is missing
    written.push({ ...f, verified: check.checked > 0 || f.fix?.kind === 'equipment' });
  }
  emit({
    stage: 'check',
    actor: 'engine',
    title: `Code checked ${quoted} quoted number${quoted === 1 ? '' : 's'} against the plant${thrown.length ? `: threw out ${thrown.length} finding${thrown.length === 1 ? '' : 's'}` : ''}`,
    detail: thrown.slice(0, 3).join(' · ') || undefined,
    ms: 0,
    status: thrown.length ? 'retry' : 'ok',
  });

  // The checker never wrote any of this. It sees the sheet and one finding at a time.
  let kept = written;
  if (written.length) {
    emit({ stage: 'check', actor: 'decisions', title: 'Checking each finding is specific to this design', ms: 0, status: 'running' });
    try {
      const questions: Record<string, Question> = {};
      written.forEach((f, i) => {
        const st = spec.stations.find((s) => s.id === f.targetIds[0]);
        questions[`f${i}`] = checkerQuestion(st ? `machine ${st.id} (${st.name ?? st.type})` : 'the plant as a whole', `${f.title}. ${f.evidence} Action: ${f.action}`);
      });
      const d = await decide(sheet, questions);
      written.forEach((f, i) => {
        const a = d.answers[`f${i}`];
        if (a?.type === 'noul') f.decisionConfidence = a.noul;
      });
      kept = written.filter((f) => f.decisionConfidence === undefined || f.decisionConfidence >= KEEP_AT);
      const dropped = written.length - kept.length;
      emit({ stage: 'check', actor: 'decisions', title: `Checker kept ${kept.length} of ${written.length} findings`, detail: dropped ? `dropped ${dropped} as generic advice` : 'every one names a machine and a checkable reason', ms: d.ms, status: 'ok' });
    } catch (e) {
      emit({ stage: 'check', actor: 'decisions', title: 'Checker unavailable; findings are shown unchecked', detail: (e as Error).message, ms: 0, status: 'fail' });
    }
  }

  // "At most two blockers each" is in the prompt and is not always obeyed, so it is enforced here:
  // each technician keeps the two blockers the checker is surest of, and the rest become warnings.
  for (const role of ADVOCATE_ROLES) {
    kept
      .filter((f) => f.role === role && f.severity === 'blocker')
      .sort((a, b) => (b.decisionConfidence ?? 0) - (a.decisionConfidence ?? 0))
      .slice(MAX_BLOCKERS)
      .forEach((f) => (f.severity = 'warning'));
  }

  const report = buildReport(spec, [...measured.findings, ...kept], 'full', crewStartTargets(spec, ev.metrics));
  for (const role of ADVOCATE_ROLES) {
    const mine = report.findings.filter((f) => f.role === role);
    emit({ stage: 'advocate', actor: 'advocate', who: role, title: `${ADVOCATE_CHARACTERS[role].name}: ${mine.length ? `${mine.length} issue${mine.length === 1 ? '' : 's'}` : 'nothing found'}`, detail: mine[0]?.title, ms: 0, status: mine.some((f) => f.severity === 'blocker') ? 'fail' : 'ok' });
  }
  emit({ stage: 'advocate', actor: 'advocate', title: `Evals done: ${report.blockerCount} blocker${report.blockerCount === 1 ? '' : 's'}, ${report.warningCount} warning${report.warningCount === 1 ? '' : 's'}, ${report.advisoryCount} note${report.advisoryCount === 1 ? '' : 's'}`, detail: report.findings[0]?.title, ms: Date.now() - t0, status: report.verdict === 'veto' ? 'fail' : 'ok' });
  return { ...report, ms: Date.now() - t0 };
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
    title: `Drafting a layout fix for ${targets.length} finding${targets.length > 1 ? 's' : ''}`,
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
      system: `You fix factory layouts. Given a valid FactorySpec, its metrics, and specific review findings, propose up to 3 concrete, rule-valid candidate patches (each a minimal list of EditOps) that resolve those exact findings without dropping throughput below demand or creating new outer-wall pinch gaps (keep stations either flush at 0 m against a wall or >= 1.5 m clear of outer walls).
Ops: move {id,x,y}; rotate {id,rot}; add {station}; remove {id}; moveDock {index,wall,offset}; setParam {path,value} (path: forklifts or stations.<id>.<field>). Set unused op fields to null. Do not lower demandPerHour.
${GEOMETRY_RULES}`,
      input: `Current FactorySpec:\n${JSON.stringify(lean(spec))}\n\nCurrent metrics:\n${situation(spec, baseEval.metrics)}\n\nFindings to resolve:\n${JSON.stringify(
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
  const scored: {
    cand: (typeof pool)[number];
    deltas: MetricDeltas;
    postAudit: AdvocateReport;
    resolvedCount: number;
    resolvedIds: string[];
    score: number;
  }[] = [];

  for (const cand of pool) {
    const ev = evaluate(cand.spec, 20);
    if (!ev.ok) continue;
    const postAudit = runDeterministicAdvocateAudit(cand.spec, ev.metrics, ev.routes, requirements);
    const remainingTargetIds = new Set(postAudit.findings.map((f) => f.id));
    // A measured finding is resolved when the engines stop reporting it. A technician's finding cannot
    // be re-measured, so it only counts when the fix actually moves the machine it is about.
    const touched = new Set(cand.ops.map((o) => ('id' in o ? o.id : null)).filter(Boolean));
    const resolvedIds = targets.filter((t) => (t.source === 'gemini' ? t.targetIds.some((id) => touched.has(id)) : !remainingTargetIds.has(t.id))).map((t) => t.id);
    const resolvedTargetCount = resolvedIds.length;
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
    scored.push({ cand, deltas, postAudit, resolvedCount, resolvedIds, score });
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

  const spokenSummary = `Simulated ${article} ${opCount}-step fix: ${best.cand.label}. It ${resolveClause}, ${buildStr && best.resolvedCount > 0 ? `${buildStr}, ` : ''}${leadStr}, and ${costStr}.`;

  emit({
    stage: 'fix',
    actor: 'fixer',
    title: `Verified fix: ${best.cand.label}`,
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
    resolvedIds: best.resolvedIds,
    remainingBlockers: best.postAudit.blockerCount,
    remainingWarnings: best.postAudit.warningCount,
    postAudit: best.postAudit,
    source: best.cand.source,
    ms: Date.now() - t0,
  };
}

/** Synthesize WAV speech for one of the 6 floor characters using Gemini 3.8 Flash-Lite TTS. */
export async function synthesizeAdvocateSpeech(role: CharacterRole, text: string) {
  const char = ADVOCATE_CHARACTERS[role] ?? ADVOCATE_CHARACTERS.process;
  return speakText({ text, voice: char.voice, style: char.style });
}

export function isCharacterRole(x: unknown): x is CharacterRole {
  return typeof x === 'string' && (x === 'fixer' || ADVOCATE_ROLES.includes(x as AdvocateRole));
}

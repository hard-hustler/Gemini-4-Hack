// The agent harness. One staged pipeline with typed artifacts and a trace:
//
//   brief (text, images, PDF, voice)
//     -> READ + PLAN   Hydrogen   -> Requirements   (what to build; never coordinates)
//     -> validate requirements in code, feed errors back, retry
//     -> EQUIP         catalog    -> EquipmentLine[] (which machine fills each step)
//     -> CHECK         Decisions  -> is each step really in the brief? how complete is the plan?
//   [user reviews and edits the bill of equipment; may swap in Shopify listings]
//     -> PLACE         engine     -> FactorySpec    (deterministic placer + seeded search)
//     -> SIMULATE      engine     -> metrics
//
// Builders (Hydrogen, Neon) propose. Checkers (validate(), Decisions API, the simulator) decide.

import { pickItem } from '../src/catalog';
import type { Emit, EquipmentLine, PlanResult, ProcessStep, Requirements, TraceEvent } from '../src/contracts';
import { buildLayout, PlaceError } from '../src/engines/place';
import { evaluate } from '../src/engines/versions';
import type { Wall } from '../src/spec';
import { decide, interact, MODELS, type Block, type Question, type Step } from './gemini';

const MAX_ATTEMPTS = 3;

/** A trace that is both collected (for the result) and streamed (for the live tracker). */
function tracer(emit?: Emit) {
  const trace: TraceEvent[] = [];
  return {
    trace,
    log: (e: TraceEvent) => {
      trace.push(e);
      emit?.(e);
    },
    running: (stage: TraceEvent['stage'], actor: TraceEvent['actor'], title: string) => emit?.({ stage, actor, title, ms: 0, status: 'running' }),
  };
}
const WALLS = ['N', 'S', 'E', 'W'];

const stepSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', description: 'one lowercase word: storage, prep, assembly, test, pack, weld, paint, inspect, label, kitting, conveyor, or another' },
    label: { type: 'string', description: 'short human name, e.g. "Final assembly"' },
    machine: { type: 'string', description: 'the equipment that does this step, named as a buyer would search for it: "CNC lathe", "parts washer", "packing bench". A noun, never the activity.' },
    count: { type: 'integer', description: 'how many stations of this type' },
    cycleTimeSec: { type: 'number', description: 'seconds per unit at one station' },
    operators: { type: 'integer' },
    powerKw: { type: 'number' },
    needsWater: { type: 'boolean' },
    w: { type: 'number', description: 'rough station width in metres' },
    d: { type: 'number', description: 'rough station depth in metres' },
    zone: { type: 'string', description: 'the department this step belongs to, e.g. "Body shop". One short name; the same for every step of that department. Empty for a single workshop.' },
  },
  required: ['type', 'label', 'machine', 'count', 'cycleTimeSec', 'operators', 'powerKw', 'needsWater', 'w', 'd', 'zone'],
};

const requirementsSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'short project name' },
    summary: { type: 'string', description: 'one sentence: what is made here and how' },
    floor: { type: 'object', properties: { width: { type: 'number' }, depth: { type: 'number' } }, required: ['width', 'depth'] },
    demandPerHour: { type: 'number' },
    steps: { type: 'array', items: stepSchema, description: 'process steps in the order a product visits them; each type appears once' },
    dockIn: { type: 'string', enum: WALLS },
    dockOut: { type: 'string', enum: WALLS },
    powerWall: { type: 'string', enum: WALLS },
    waterWall: { type: 'string', enum: WALLS },
    transport: { type: 'string', enum: ['forklift', 'conveyor'], description: 'how units move between steps: forklift in a workshop, conveyor on a production line or plant' },
    sketch: {
      type: 'array',
      description: 'ONLY if the brief includes a drawing of the floor: one entry per drawn station, its centre as a fraction of floor width (fx, 0 = west wall, 1 = east wall) and depth (fy, 0 = north wall, 1 = south wall), measured between the drawn walls and not the edges of the photo. Otherwise empty.',
      items: { type: 'object', properties: { type: { type: 'string' }, fx: { type: 'number' }, fy: { type: 'number' } }, required: ['type', 'fx', 'fy'] },
    },
    assumptions: { type: 'array', items: { type: 'string' }, description: 'each thing you had to assume because the brief did not say' },
  },
  required: ['name', 'summary', 'floor', 'demandPerHour', 'steps', 'dockIn', 'dockOut', 'powerWall', 'waterWall', 'transport', 'sketch', 'assumptions'],
};

const PLAN_SYSTEM = `You are the planner in a factory-planning harness. You read a brief (text, photos of sketches, documents, voice notes) for a small light-manufacturing workshop and emit its requirements as JSON.
You decide WHAT is needed: the process steps in order, how many stations each step needs, and the process numbers. You never decide coordinates; a deterministic placer does that.
Station counts: if the brief gives a count for a step, use exactly that count, even if it looks too low for the demand; the simulator will show the shortfall and that is the point. Only when the brief gives no count, size it as ceil(demandPerHour * cycleTimeSec / 3600 / 0.85).
Typical cycle times (s): storage 20, kitting 50, prep 80, assembly 200, weld 150, paint 180, test 90, inspect 60, label 30, pack 70. Typical station footprint is 2 to 3 m wide by 1 to 2 m deep.
If the brief gives no floor size, choose one that fits the equipment with room for 1.2 m aisles (roughly five times the total equipment footprint) and say so in assumptions. North is the top of any drawing.
If the brief does not say where docks or utilities are, pick sensible walls and list each as an assumption. Do not invent steps the brief does not ask for or imply.
For each step, "label" is the activity ("CNC turning") and "machine" is the equipment a buyer would search a catalog for ("CNC lathe", "parts washer", "coordinate measuring machine"). The machine name is what gets searched on a marketplace, so make it a plain product noun.
If the brief includes a drawing of the floor, "sketch" has one entry for every box drawn: five boxes of the same machine are five entries with the same type, each at its own position. Read positions off the drawing; do not tidy them. Measure from the walls as drawn: a box touching the west wall has fx near 0 and one touching the east wall has fx near 1, however much blank paper surrounds the floor in the photo.`;

/** Added to the planner's instructions when the brief is a production line or a whole plant. */
const largeSystem = (scale: 'line' | 'plant') => `
This brief is for ${scale === 'plant' ? 'a whole plant' : 'a production line'}, not a workshop. Plan it as one:
- Use the research notes. They say how this product is really made; follow their departments and steps rather than guessing.
- Group the steps into departments with the "zone" field, in the order material flows through them (for a car plant: Stamping, Body shop, Paint shop, General assembly, Final inspection). Every step has a zone.
- ${
  scale === 'plant'
    ? 'Use 14 to 30 steps in total.'
    : 'Use the steps the brief names, in its order: usually 8 to 16. Do not pad the line with staging, buffer, gauging, drying or handling steps that neither the brief nor the research asks for; an independent checker removes steps it cannot find in the brief.'
} Each step is one kind of station; "type" is one unique lowercase word made of letters (bodyframing, ecoat, marriage), and "label" is the human name.
- Size each step by takt: count = ceil(demandPerHour * cycleTimeSec / 3600 / 0.85), between 1 and 40. Slow processes (ovens, curing, framing) need many stations in parallel; fast ones need one or two.
- Give each step a realistic single-station footprint (w, d up to 12 m) and power draw from the research.
- transport is "conveyor".
- If the brief gives a floor size, use it. Otherwise choose a floor that holds everything with aisles: about four times the total equipment footprint, wider than deep (for example 150 by 90 m), and say so in assumptions.
- sketch is empty unless the brief includes a drawing of the floor.`;

function clean(raw: any): Requirements {
  const num = (v: unknown, f: number) => (typeof v === 'number' && Number.isFinite(v) ? v : f);
  const wall = (v: unknown, f: Wall) => (WALLS.includes(v as string) ? (v as Wall) : f);
  const seen = new Set<string>();
  const steps: ProcessStep[] = [];
  for (const s of Array.isArray(raw?.steps) ? raw.steps : []) {
    const type = String(s?.type ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!type) continue;
    if (seen.has(type)) {
      // same type listed twice: merge, do not create a loop in the routing
      const first = steps.find((x) => x.type === type)!;
      first.count += Math.max(1, Math.round(num(s?.count, 1)));
      continue;
    }
    seen.add(type);
    steps.push({
      type,
      label: String(s?.label ?? type),
      machine: typeof s?.machine === 'string' && s.machine.trim() ? s.machine.trim().slice(0, 60) : undefined,
      count: Math.round(num(s?.count, 1)),
      cycleTimeSec: num(s?.cycleTimeSec, 60),
      operators: Math.max(0, Math.round(num(s?.operators, 1))),
      powerKw: Math.max(0, num(s?.powerKw, 0)),
      needsWater: Boolean(s?.needsWater),
      w: num(s?.w, 2),
      d: num(s?.d, 1),
      zone: typeof s?.zone === 'string' && s.zone.trim() ? s.zone.trim().slice(0, 40) : undefined,
    });
  }
  return {
    name: String(raw?.name ?? 'Untitled project').slice(0, 60),
    summary: String(raw?.summary ?? ''),
    floor: { width: num(raw?.floor?.width, 0), depth: num(raw?.floor?.depth, 0) },
    demandPerHour: num(raw?.demandPerHour, 0),
    steps,
    dockIn: wall(raw?.dockIn, 'W'),
    dockOut: wall(raw?.dockOut, 'E'),
    powerWall: wall(raw?.powerWall, 'N'),
    waterWall: wall(raw?.waterWall, 'S'),
    transport: raw?.transport === 'conveyor' ? 'conveyor' : 'forklift',
    sketch: (Array.isArray(raw?.sketch) ? raw.sketch : [])
      .map((h: any) => ({ type: String(h?.type ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''), fx: num(h?.fx, 0.5), fy: num(h?.fy, 0.5) }))
      .filter((h: { type: string; fx: number; fy: number }) => seen.has(h.type) && h.fx >= 0 && h.fx <= 1 && h.fy >= 0 && h.fy <= 1),
    assumptions: (Array.isArray(raw?.assumptions) ? raw.assumptions : []).map(String).slice(0, 8),
  };
}

/** Code, not a model, decides whether requirements are usable. Each message is written to be fed back. */
export function checkRequirements(r: Requirements): string[] {
  const errs: string[] = [];
  if (!r.steps.length) errs.push('steps is empty: list the process steps in order');
  if (!(r.floor.width >= 4 && r.floor.width <= 600 && r.floor.depth >= 4 && r.floor.depth <= 600)) errs.push(`floor ${r.floor.width} x ${r.floor.depth} m is not a plausible floor (each side 4 to 600 m)`);
  if (r.steps.length > 40) errs.push(`${r.steps.length} steps is more than 40: merge closely related steps`);
  const stations = r.steps.reduce((t, s) => t + Math.max(0, s.count), 0);
  if (stations > 180) errs.push(`${stations} stations in total is more than 180: raise cycle-time assumptions or merge steps so counts come down`);
  if (!(r.demandPerHour > 0 && r.demandPerHour <= 2000)) errs.push(`demandPerHour ${r.demandPerHour} must be between 1 and 2000`);
  for (const s of r.steps) {
    if (!(s.count >= 1 && s.count <= 40)) errs.push(`step "${s.type}": count ${s.count} must be 1 to 40`);
    if (!(s.cycleTimeSec > 0)) errs.push(`step "${s.type}": cycleTimeSec must be positive`);
    if (!(s.w >= 0.5 && s.w <= 12 && s.d >= 0.5 && s.d <= 12)) errs.push(`step "${s.type}": footprint ${s.w} x ${s.d} m is not plausible (0.5 to 12 m per side)`);
  }
  const area = r.steps.reduce((t, s) => t + s.count * s.w * s.d, 0);
  if (r.floor.width > 0 && area > r.floor.width * r.floor.depth * 0.6) {
    errs.push(`equipment footprint ${area.toFixed(0)} m² is more than 60% of the ${(r.floor.width * r.floor.depth).toFixed(0)} m² floor: check the station footprints, and enlarge the floor only if the brief did not fix its size. Do not change station counts the brief gives.`);
  }
  return errs;
}

export interface BriefFile {
  name: string;
  mimeType: string;
  data: string;
}

function briefBlocks(text: string, files: BriefFile[]): Block[] {
  const blocks: Block[] = [];
  for (const f of files) {
    const mime = f.mimeType.split(';')[0];
    const type = mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'audio' : 'document';
    blocks.push({ type, data: f.data, mime_type: mime });
  }
  if (text.trim()) blocks.push({ type: 'text', text: `Brief:\n${text.trim()}\n` });
  return blocks;
}

/** Stage 1 to 3: brief -> requirements -> bill of equipment -> checks. No layout yet; the user reviews first. */
export async function planProject(text: string, files: BriefFile[], emit?: Emit): Promise<PlanResult> {
  const { trace, log, running } = tracer(emit);
  const brief = briefBlocks(text, files);
  if (!brief.length) throw new Error('The brief is empty');
  const kinds = [text.trim() ? 'text' : '', ...new Set(files.map((f) => f.mimeType.split('/')[0]))].filter(Boolean).join(', ');

  // SCOPE: how big is this? A workshop goes straight to planning. A line or a plant gets researched first,
  // because one model call from memory plans a car factory about as well as a person would from memory.
  let scale: 'workshop' | 'line' | 'plant' = 'workshop';
  try {
    running('read', 'decisions', 'Sizing up the brief');
    const d = await decide(brief, {
      scale: {
        type: 'choice',
        instructions: 'The input is a brief for something to be manufactured. How large an operation does it describe?',
        criteria: {
          workshop: 'a single room or small workshop: roughly 15 stations or fewer, one team',
          line: 'one production line: roughly 15 to 40 stations, a product moving along it',
          plant: 'a whole factory with several departments, such as a car plant or an appliance factory',
        },
      },
    });
    const a = d.answers.scale;
    if (a?.type === 'choice' && (a.choice === 'line' || a.choice === 'plant') && a.confidence >= 0.5) scale = a.choice;
    log({ stage: 'read', actor: 'decisions', title: `Sized the brief as a ${scale}`, detail: a?.type === 'choice' ? `${Math.round(a.confidence * 100)}% sure` : undefined, ms: d.ms, status: 'ok' });
  } catch (e) {
    log({ stage: 'read', actor: 'decisions', title: 'Could not size the brief; planning it as a workshop', detail: (e as Error).message, ms: 0, status: 'fail' });
  }
  const large = scale !== 'workshop';

  // RESEARCH: grounded in web search, so the plan follows how the product is really made.
  let research: Requirements['research'];
  if (large) {
    running('research', 'hydrogen', 'Researching how this is made');
    try {
      const res = await interact({
        model: MODELS.hydrogen,
        input: [
          ...brief,
          {
            type: 'text',
            text: `Research how the product in this brief is manufactured at the scale described, using web search. Write working notes for a factory planner, in plain text, under 450 words:
1. The departments, in the order material flows through them.
2. For each department: its process steps in order, the equipment each step uses, a typical cycle time per unit at one station (seconds), a typical single-station footprint (metres), and power draw (kW).
3. How units move between steps (conveyor types, AGVs, overhead carriers).
4. Typical output per hour and floor area for a plant of this kind.
Take every number you can from the search results, and say "estimate" where you had to estimate.`,
          },
        ],
        tools: [{ type: 'google_search' }],
        thinking: 'low',
      });
      research = { summary: res.text.trim(), sources: res.sources.slice(0, 12), queries: res.queries.slice(0, 8) };
      log({
        stage: 'research',
        actor: 'hydrogen',
        title: `Researched the process: ${research.sources.length} source${research.sources.length === 1 ? '' : 's'}`,
        detail: research.queries.length ? `searched: ${research.queries.slice(0, 4).join('; ')}` : `${research.summary.split(/\s+/).length} words of notes`,
        ms: res.ms,
        status: research.sources.length ? 'ok' : 'retry',
      });
    } catch (e) {
      log({ stage: 'research', actor: 'hydrogen', title: 'Research failed; planning from the brief alone', detail: (e as Error).message, ms: 0, status: 'fail' });
    }
  }
  const evidence: Block[] = research ? [...brief, { type: 'text', text: `\nResearch notes on how this is made:\n${research.summary}\n` }] : brief;
  const system = scale === 'workshop' ? PLAN_SYSTEM : PLAN_SYSTEM + largeSystem(scale);

  const steps: Step[] = [{ type: 'user_input', content: [...evidence, { type: 'text', text: 'Emit the requirements for this brief.' }] }];
  let req: Requirements | null = null;
  let errs: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    running(attempt === 1 ? 'read' : 'plan', 'hydrogen', attempt === 1 ? 'Reading the brief' : 'Revising the plan');
    const res = await interact<any>({ model: MODELS.hydrogen, input: steps, system, schema: requirementsSchema, thinking: large ? 'medium' : 'low', maxOutputTokens: 30000 });
    const candidate = clean(res.json);
    if (large) candidate.transport = 'conveyor';
    candidate.research = research;
    candidate.scale = scale;
    errs = checkRequirements(candidate);
    log({
      stage: attempt === 1 ? 'read' : 'plan',
      actor: 'hydrogen',
      title: attempt === 1 ? (large ? `Planned the ${scale}` : `Read the brief (${kinds})`) : `Revised the plan (attempt ${attempt})`,
      detail: errs.length ? errs.join('; ') : `${candidate.steps.length} steps${large ? ` in ${new Set(candidate.steps.map((x) => x.zone)).size} departments` : ''}, ${candidate.steps.reduce((t, s) => t + s.count, 0)} stations, ${candidate.floor.width} x ${candidate.floor.depth} m`,
      ms: res.ms,
      status: errs.length ? 'retry' : 'ok',
    });
    if (!errs.length) {
      req = candidate;
      break;
    }
    steps.push({ type: 'model_output', content: [{ type: 'text', text: res.text }] });
    steps.push({ type: 'user_input', content: [{ type: 'text', text: `Those requirements were rejected. Fix every problem and emit the full requirements again.\n${errs.map((e) => `- ${e}`).join('\n')}` }] });
  }
  if (!req) {
    log({ stage: 'plan', actor: 'engine', title: 'No usable plan', detail: errs.join('; '), ms: 0, status: 'fail' });
    throw Object.assign(new Error(`Could not turn this brief into a usable plan after ${MAX_ATTEMPTS} attempts`), { lines: errs, trace });
  }

  // Bind equipment, then let the checker (which sees only the brief) judge the plan. If it finds a
  // step count that contradicts the brief, that goes back to the planner once: checker feeds builder.
  let equipment: EquipmentLine[] = [];
  let coverage: number | undefined;
  for (let round = 0; round < 2; round++) {
    const t0 = Date.now();
    equipment = req.steps.map((s) => ({ stepType: s.type, label: s.label, machine: s.machine, qty: s.count, item: pickItem(s) }));
    const generic = equipment.filter((l) => l.item.id.startsWith('generic-')).length;
    log({ stage: 'equip', actor: 'engine', title: 'Matched equipment from the catalog', detail: `${equipment.length - generic} catalog items${generic ? `, ${generic} generic placeholder${generic > 1 ? 's' : ''}` : ''}`, ms: Date.now() - t0, status: 'ok' });

    const contradicted: string[] = [];
    try {
      const questions: Record<string, Question> = {};
      equipment.forEach((l, i) => {
        questions[`s${i}`] = { type: 'noul', instructions: `The input is a brief for a factory or workshop, with research notes where the project is large. Does the brief ask for, show, or clearly imply a "${l.label}" (${l.stepType}) step in the process?` };
        questions[`n${i}`] = {
          type: 'choice',
          instructions: `The input is a brief for a factory or workshop, with research notes where the project is large. A planner decided the workshop needs ${l.qty} "${l.label}" (${l.stepType}) station${l.qty > 1 ? 's' : ''}. What does the brief itself say about how many of these there are?`,
          criteria: {
            agrees: `the brief states or shows exactly ${l.qty}`,
            differs: `the brief states or shows a different number than ${l.qty}`,
            silent: 'the brief does not say how many',
          },
        };
      });
      questions.coverage = {
        type: 'score',
        instructions: `The input is a brief for a factory or workshop, with research notes where the project is large. A planner read it and listed these process steps, in order: ${req.steps.map((s) => `${s.count} x ${s.label}`).join(', ')}. How completely and faithfully does that list cover the process the brief describes?`,
        criteria: ['misses most of what the brief asks for', 'misses or invents several steps', 'roughly right with one clear gap or extra', 'covers the brief with minor differences', 'covers everything the brief asks for and nothing else'],
      };
      running('check', 'decisions', 'Checking the plan against the brief');
      const d = await decide(evidence, questions);
      equipment.forEach((l, i) => {
        const a = d.answers[`s${i}`];
        if (a?.type === 'noul') l.inBrief = a.noul;
        const n = d.answers[`n${i}`];
        if (n?.type === 'choice' && n.choice === 'differs' && n.confidence >= 0.6) contradicted.push(`"${l.label}" (${l.stepType}): you gave ${l.qty}, but the brief gives a different number. Use exactly the number the brief gives.`);
      });
      const c = d.answers.coverage;
      if (c?.type === 'score') coverage = c.score / 4;
      const doubtful = equipment.filter((l) => (l.inBrief ?? 1) < 0.5);
      log({
        stage: 'check',
        actor: 'decisions',
        title: contradicted.length ? 'Check found counts that contradict the brief' : 'Checked the plan against the brief',
        detail: `coverage ${coverage !== undefined ? Math.round(coverage * 100) + '%' : 'n/a'}${contradicted.length ? `; ${contradicted.length} count${contradicted.length > 1 ? 's' : ''} differ from the brief` : ''}${doubtful.length ? `; not clearly in the brief: ${doubtful.map((l) => l.label).join(', ')}` : contradicted.length ? '' : '; every step is in the brief'}`,
        ms: d.ms,
        status: contradicted.length ? 'retry' : 'ok',
      });
    } catch (e) {
      log({ stage: 'check', actor: 'decisions', title: 'Check against the brief failed', detail: (e as Error).message, ms: 0, status: 'fail' });
    }
    if (!contradicted.length || round === 1) break;

    // one revision, driven by the checker's findings
    steps.push({ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(req) }] });
    steps.push({ type: 'user_input', content: [{ type: 'text', text: `An independent check against the brief found these problems. Fix them, change nothing else, and emit the full requirements again.\n${contradicted.map((c) => `- ${c}`).join('\n')}` }] });
    try {
      running('plan', 'hydrogen', 'Revising the plan after the check');
      const res = await interact<any>({ model: MODELS.hydrogen, input: steps, system, schema: requirementsSchema, thinking: large ? 'medium' : 'low', maxOutputTokens: 30000 });
      const revised = clean(res.json);
      if (large) revised.transport = 'conveyor';
      revised.research = research;
      revised.scale = scale;
      const bad = checkRequirements(revised);
      log({ stage: 'plan', actor: 'hydrogen', title: 'Revised the plan after the check', detail: bad.length ? `revision rejected, keeping the first plan: ${bad.join('; ')}` : revised.steps.map((s) => `${s.count} x ${s.label}`).join(', '), ms: res.ms, status: bad.length ? 'fail' : 'ok' });
      if (bad.length) break;
      req = revised;
    } catch (e) {
      log({ stage: 'plan', actor: 'hydrogen', title: 'Revision failed, keeping the first plan', detail: (e as Error).message, ms: 0, status: 'fail' });
      break;
    }
  }
  return { requirements: req, equipment, coverage, trace };
}

/** Stage 4 and 5: approved requirements + equipment -> placed, validated, simulated layout. */
export function layoutProject(requirements: Requirements, equipment: EquipmentLine[], emit?: Emit) {
  const { trace, log, running } = tracer(emit);
  running('place', 'engine', 'Placing the equipment');
  const t0 = Date.now();
  try {
    // First layout is the tidy flow line. Squeezing out travel is the Improve step's job, on request.
    const placed = buildLayout(requirements, equipment, { polish: false });
    log({
      stage: 'place',
      actor: 'engine',
      title: placed.method === 'as drawn' ? 'Placed equipment as drawn' : 'Placed equipment along the process flow',
      detail: `${placed.spec.stations.length} stations, ${placed.variantsTried} arrangement${placed.variantsTried > 1 ? 's' : ''} tried${placed.polished ? `, search improved it by ${Math.round((1 - placed.polishScore) * 100)}%` : ''}; passes every layout rule`,
      ms: Date.now() - t0,
      status: 'ok',
    });
    const t1 = Date.now();
    const ev = evaluate(placed.spec);
    if (!ev.ok) throw new PlaceError('Placed layout failed validation', ev.errors);
    log({
      stage: 'simulate',
      actor: 'engine',
      title: 'Simulated 30 shifts',
      detail: `${ev.metrics.sim.unitsPerHour.median.toFixed(1)} units/h against demand ${placed.spec.demandPerHour}; bottleneck ${ev.metrics.sim.bottleneck.name} at ${Math.round(ev.metrics.sim.bottleneck.utilisation * 100)}%`,
      ms: Date.now() - t1,
      status: 'ok',
    });
    return { spec: placed.spec, method: placed.method, trace };
  } catch (e) {
    const lines = e instanceof PlaceError ? e.errors.map((x) => x.message) : [];
    log({ stage: 'place', actor: 'engine', title: 'Could not place the equipment', detail: (e as Error).message, ms: Date.now() - t0, status: 'fail' });
    throw Object.assign(new Error((e as Error).message), { lines, trace });
  }
}

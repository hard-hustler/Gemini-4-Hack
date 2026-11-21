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
import type { CatalogItem, EquipmentLine, PlanResult, ProcessStep, Requirements, ShopListing, TraceEvent } from '../src/contracts';
import { buildLayout, PlaceError } from '../src/engines/place';
import { evaluate } from '../src/engines/versions';
import type { Wall } from '../src/spec';
import { decide, interact, MODELS, type Block, type Question, type Step } from './gemini';

const MAX_ATTEMPTS = 3;
const WALLS = ['N', 'S', 'E', 'W'];

const stepSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', description: 'one lowercase word: storage, prep, assembly, test, pack, weld, paint, inspect, label, kitting, conveyor, or another' },
    label: { type: 'string', description: 'short human name, e.g. "Final assembly"' },
    count: { type: 'integer', description: 'how many stations of this type' },
    cycleTimeSec: { type: 'number', description: 'seconds per unit at one station' },
    operators: { type: 'integer' },
    powerKw: { type: 'number' },
    needsWater: { type: 'boolean' },
    w: { type: 'number', description: 'rough station width in metres' },
    d: { type: 'number', description: 'rough station depth in metres' },
  },
  required: ['type', 'label', 'count', 'cycleTimeSec', 'operators', 'powerKw', 'needsWater', 'w', 'd'],
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
    sketch: {
      type: 'array',
      description: 'ONLY if the brief includes a drawing of the floor: one entry per drawn station, its centre as a fraction of floor width (fx, 0 = west) and depth (fy, 0 = north). Otherwise empty.',
      items: { type: 'object', properties: { type: { type: 'string' }, fx: { type: 'number' }, fy: { type: 'number' } }, required: ['type', 'fx', 'fy'] },
    },
    assumptions: { type: 'array', items: { type: 'string' }, description: 'each thing you had to assume because the brief did not say' },
  },
  required: ['name', 'summary', 'floor', 'demandPerHour', 'steps', 'dockIn', 'dockOut', 'powerWall', 'waterWall', 'sketch', 'assumptions'],
};

const PLAN_SYSTEM = `You are the planner in a factory-planning harness. You read a brief (text, photos of sketches, documents, voice notes) for a small light-manufacturing workshop and emit its requirements as JSON.
You decide WHAT is needed: the process steps in order, how many stations each step needs, and the process numbers. You never decide coordinates; a deterministic placer does that.
Sizing: a step needs at least ceil(demandPerHour * cycleTimeSec / 3600 / 0.85) stations to keep up with demand. Use the count the brief gives if it gives one; otherwise size it with that rule.
Typical cycle times (s): storage 20, kitting 50, prep 80, assembly 200, weld 150, paint 180, test 90, inspect 60, label 30, pack 70. Typical station footprint is 2 to 3 m wide by 1 to 2 m deep.
If the brief gives no floor size, choose one that fits the equipment with room for 1.2 m aisles (roughly five times the total equipment footprint) and say so in assumptions. North is the top of any drawing.
If the brief does not say where docks or utilities are, pick sensible walls and list each as an assumption. Do not invent steps the brief does not ask for or imply.`;

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
      count: Math.round(num(s?.count, 1)),
      cycleTimeSec: num(s?.cycleTimeSec, 60),
      operators: Math.max(0, Math.round(num(s?.operators, 1))),
      powerKw: Math.max(0, num(s?.powerKw, 0)),
      needsWater: Boolean(s?.needsWater),
      w: num(s?.w, 2),
      d: num(s?.d, 1),
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
  if (!(r.floor.width >= 4 && r.floor.width <= 200 && r.floor.depth >= 4 && r.floor.depth <= 200)) errs.push(`floor ${r.floor.width} x ${r.floor.depth} m is not a plausible workshop floor (each side 4 to 200 m)`);
  if (!(r.demandPerHour > 0 && r.demandPerHour <= 2000)) errs.push(`demandPerHour ${r.demandPerHour} must be between 1 and 2000`);
  for (const s of r.steps) {
    if (!(s.count >= 1 && s.count <= 12)) errs.push(`step "${s.type}": count ${s.count} must be 1 to 12`);
    if (!(s.cycleTimeSec > 0)) errs.push(`step "${s.type}": cycleTimeSec must be positive`);
    if (!(s.w >= 0.5 && s.w <= 12 && s.d >= 0.5 && s.d <= 12)) errs.push(`step "${s.type}": footprint ${s.w} x ${s.d} m is not plausible (0.5 to 12 m per side)`);
  }
  const area = r.steps.reduce((t, s) => t + s.count * s.w * s.d, 0);
  if (r.floor.width > 0 && area > r.floor.width * r.floor.depth * 0.45) {
    errs.push(`equipment footprint ${area.toFixed(0)} m² is more than 45% of the ${(r.floor.width * r.floor.depth).toFixed(0)} m² floor: enlarge the floor (if the brief did not fix it) or reduce station counts`);
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
export async function planProject(text: string, files: BriefFile[]): Promise<PlanResult> {
  const trace: TraceEvent[] = [];
  const brief = briefBlocks(text, files);
  if (!brief.length) throw new Error('The brief is empty');
  const kinds = [text.trim() ? 'text' : '', ...new Set(files.map((f) => f.mimeType.split('/')[0]))].filter(Boolean).join(', ');

  const steps: Step[] = [{ type: 'user_input', content: [...brief, { type: 'text', text: 'Emit the requirements for this brief.' }] }];
  let req: Requirements | null = null;
  let errs: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await interact<any>({ model: MODELS.hydrogen, input: steps, system: PLAN_SYSTEM, schema: requirementsSchema, thinking: 'low' });
    const candidate = clean(res.json);
    errs = checkRequirements(candidate);
    trace.push({
      stage: attempt === 1 ? 'read' : 'plan',
      actor: 'hydrogen',
      title: attempt === 1 ? `Read the brief (${kinds})` : `Revised the plan (attempt ${attempt})`,
      detail: errs.length ? errs.join('; ') : `${candidate.steps.length} steps, ${candidate.steps.reduce((t, s) => t + s.count, 0)} stations, ${candidate.floor.width} x ${candidate.floor.depth} m`,
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
    trace.push({ stage: 'plan', actor: 'engine', title: 'No usable plan', detail: errs.join('; '), ms: 0, status: 'fail' });
    throw Object.assign(new Error(`Could not turn this brief into a usable plan after ${MAX_ATTEMPTS} attempts`), { lines: errs, trace });
  }

  const t0 = Date.now();
  const equipment: EquipmentLine[] = req.steps.map((s) => ({ stepType: s.type, label: s.label, qty: s.count, item: pickItem(s) }));
  const generic = equipment.filter((l) => l.item.id.startsWith('generic-')).length;
  trace.push({ stage: 'equip', actor: 'engine', title: 'Matched equipment from the catalog', detail: `${equipment.length - generic} catalog items${generic ? `, ${generic} generic placeholder${generic > 1 ? 's' : ''}` : ''}`, ms: Date.now() - t0, status: 'ok' });

  // Checker: independent of the planner, sees only the brief. Guards against invented or missed steps.
  let coverage: number | undefined;
  try {
    const questions: Record<string, Question> = {};
    equipment.forEach((l, i) => {
      questions[`s${i}`] = { type: 'noul', instructions: `The input is a brief for a small factory or workshop. Does the brief ask for, show, or clearly imply a "${l.label}" (${l.stepType}) step in the process?` };
    });
    questions.coverage = {
      type: 'score',
      instructions: `The input is a brief for a small factory or workshop. A planner read it and listed these process steps, in order: ${req.steps.map((s) => `${s.count} x ${s.label}`).join(', ')}. How completely and faithfully does that list cover the process the brief describes?`,
      criteria: ['misses most of what the brief asks for', 'misses or invents several steps', 'roughly right with one clear gap or extra', 'covers the brief with minor differences', 'covers everything the brief asks for and nothing else'],
    };
    const d = await decide(brief, questions);
    equipment.forEach((l, i) => {
      const a = d.answers[`s${i}`];
      if (a?.type === 'noul') l.inBrief = a.noul;
    });
    const c = d.answers.coverage;
    if (c?.type === 'score') coverage = c.score / 4;
    const doubtful = equipment.filter((l) => (l.inBrief ?? 1) < 0.5);
    trace.push({
      stage: 'check',
      actor: 'decisions',
      title: 'Checked the plan against the brief',
      detail: `coverage ${coverage !== undefined ? Math.round(coverage * 100) + '%' : 'n/a'}${doubtful.length ? `; not clearly in the brief: ${doubtful.map((l) => l.label).join(', ')}` : '; every step is in the brief'}`,
      ms: d.ms,
      status: 'ok',
    });
  } catch (e) {
    trace.push({ stage: 'check', actor: 'decisions', title: 'Check against the brief failed', detail: (e as Error).message, ms: 0, status: 'fail' });
  }
  return { requirements: req, equipment, coverage, trace };
}

/** Stage 4 and 5: approved requirements + equipment -> placed, validated, simulated layout. */
export function layoutProject(requirements: Requirements, equipment: EquipmentLine[]) {
  const trace: TraceEvent[] = [];
  const t0 = Date.now();
  try {
    const placed = buildLayout(requirements, equipment);
    trace.push({
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
    trace.push({
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
    trace.push({ stage: 'place', actor: 'engine', title: 'Could not place the equipment', detail: (e as Error).message, ms: Date.now() - t0, status: 'fail' });
    throw Object.assign(new Error((e as Error).message), { lines, trace });
  }
}

const itemSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'short product name, at most six words' },
    w: { type: 'number', description: 'width in metres (the longer horizontal side)' },
    d: { type: 'number', description: 'depth in metres' },
    h: { type: 'number', description: 'height in metres' },
    powerKw: { type: 'number', description: 'electrical draw in kW; 0 if it is not powered' },
    needsWater: { type: 'boolean' },
    shape: { type: 'string', enum: ['bench', 'rack', 'machine', 'table', 'conveyor'] },
    dimsStated: { type: 'boolean', description: 'true only if the listing text states the dimensions you used' },
  },
  required: ['name', 'w', 'd', 'h', 'powerKw', 'needsWater', 'shape', 'dimsStated'],
};

/** Shopify listing -> CatalogItem. Hydrogen reads the specs; Decisions says whether it suits the step. */
export async function convertListing(listing: ShopListing, step: { type: string; label: string; cycleTimeSec: number; operators: number }) {
  const trace: TraceEvent[] = [];
  const text = `Title: ${listing.title}\nSeller: ${listing.seller}\nPrice: ${listing.price} ${listing.currency}\n${listing.dims ? `Size option: ${listing.dims.text}\n` : ''}Description: ${(listing.description ?? '').slice(0, 4000)}`;
  const res = await interact<any>({
    model: MODELS.hydrogen,
    input: `Read this product listing and emit its physical specs for a factory floor planner. Convert inches to metres (1 in = 0.0254 m). If a dimension is not stated, estimate it from the product type and set dimsStated false.\n\n${text}`,
    schema: itemSchema,
    thinking: 'low',
  });
  const j = res.json ?? {};
  const side = (v: unknown, f: number) => (typeof v === 'number' && v >= 0.2 && v <= 12 ? Math.round(v * 100) / 100 : f);
  trace.push({ stage: 'convert', actor: 'hydrogen', title: 'Read specs from the listing', detail: `${side(j.w, 2)} x ${side(j.d, 1)} x ${side(j.h, 1)} m${j.dimsStated ? '' : ' (estimated, not stated)'}`, ms: res.ms, status: 'ok' });

  let confidence: number | undefined;
  try {
    const d = await decide(text, {
      fit: { type: 'noul', instructions: `The input is a product listing. Is this product suitable equipment for a "${step.label}" (${step.type}) station in a small light-manufacturing workshop?` },
    });
    const a = d.answers.fit;
    if (a?.type === 'noul') confidence = a.noul;
    trace.push({ stage: 'check', actor: 'decisions', title: 'Checked the listing suits the step', detail: `${Math.round((confidence ?? 0) * 100)}% suitable for ${step.label}`, ms: d.ms, status: 'ok' });
  } catch (e) {
    trace.push({ stage: 'check', actor: 'decisions', title: 'Suitability check failed', detail: (e as Error).message, ms: 0, status: 'fail' });
  }

  const item: CatalogItem = {
    id: `shop-${listing.variantId.split('/').pop()}`,
    name: String(j.name ?? listing.title).slice(0, 60),
    stationType: step.type,
    footprint: { w: side(j.w, 2), d: side(j.d, 1), h: side(j.h, 1) },
    cycleTimeSec: step.cycleTimeSec,
    operators: step.operators,
    powerKw: typeof j.powerKw === 'number' && j.powerKw >= 0 ? j.powerKw : 0,
    needsWater: Boolean(j.needsWater),
    price: listing.price,
    source: 'shopify',
    listing: { ...listing, description: undefined },
    shape: j.shape,
    confidence,
    // modelUrl: filled in by the listing -> 3D converter when it is ready
  };
  return { item, dimsStated: Boolean(j.dimsStated), trace };
}

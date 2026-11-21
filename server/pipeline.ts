// Model jobs. Loop rule: propose -> validate -> on errors feed them back and retry.
// Nothing leaves this file unless it passed validate().

import { validate, type ValidationError } from '../src/engines/validate';
import { applyOps, centre, dockPoint, leanSpec, snap, type EditOp, type FactorySpec, type Rot, type Station, type Wall } from '../src/spec';
import { decide, interact, MODELS, type Block, type Question, type Step } from './gemini';

const MAX_ATTEMPTS = 3;
const CELL = 0.5;

const DEFAULT_COSTS: FactorySpec['costs'] = { labourPerHour: 28, electricityPerKwh: 0.16, powerRunPerM: 45, waterRunPerM: 70 };

const STATION_DEFAULTS = `Typical values per station type for a small light-assembly workshop (use these unless the input says otherwise):
type      | w x d (m) | cycleTimeSec | operators | powerKw | needsWater | price USD
storage   | 3 x 1.5   | 20           | 0         | 0       | false      | 450
prep      | 2 x 1     | 80           | 1         | 1.5     | true       | 600
assembly  | 2.5 x 1   | 200          | 1         | 0.8     | false      | 700
test      | 2 x 1     | 90           | 1         | 2       | false      | 1200
pack      | 2.5 x 1.5 | 70           | 1         | 0.5     | false      | 500
Other types are allowed (lowercase, one word); pick sensible values.`;

export const GEOMETRY_RULES = `Coordinate system: metres. Origin is the north-west corner of the floor; x runs east (0..floor.width), y runs south (0..floor.depth). North is the top of a drawing.
A station's x,y is the north-west corner of its footprint; w is its east-west size and d its north-south size when rot is 0. rot 90 or 270 swaps them.
All positions and sizes are multiples of ${CELL} m.
Hard rules the layout must satisfy:
- every station lies fully inside the floor and no two stations overlap;
- two stations that face each other are either flush (gap 0) or at least 1.2 m apart;
- docks sit on an outside wall: wall is N, S, E or W and offset is metres along that wall from its west end (N, S) or north end (E, W);
- every station must be reachable by forklift from the inbound dock, so do not wall anything in;
- every type named in routing has at least one station.`;

const stationSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'short unique id, e.g. asm1' },
    type: { type: 'string', description: 'station type, lowercase, e.g. storage, prep, assembly, test, pack' },
    x: { type: 'number' },
    y: { type: 'number' },
    w: { type: 'number' },
    d: { type: 'number' },
    rot: { type: 'integer', enum: [0, 90, 180, 270] },
    cycleTimeSec: { type: 'number' },
    operators: { type: 'integer' },
    powerKw: { type: 'number' },
    needsWater: { type: 'boolean' },
    price: { type: 'number' },
  },
  required: ['id', 'type', 'x', 'y', 'w', 'd', 'rot', 'cycleTimeSec', 'operators', 'powerKw', 'needsWater', 'price'],
};

const pointSchema = { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] };

const planSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    floor: { type: 'object', properties: { width: { type: 'number' }, depth: { type: 'number' } }, required: ['width', 'depth'] },
    docks: {
      type: 'array',
      items: {
        type: 'object',
        properties: { wall: { type: 'string', enum: ['N', 'S', 'E', 'W'] }, offset: { type: 'number' }, kind: { type: 'string', enum: ['in', 'out'] } },
        required: ['wall', 'offset', 'kind'],
      },
    },
    utilityEntry: { type: 'object', properties: { power: pointSchema, water: pointSchema }, required: ['power', 'water'] },
    stations: { type: 'array', items: stationSchema },
    routing: { type: 'array', items: { type: 'string' }, description: 'ordered station types a product visits' },
    demandPerHour: { type: 'number' },
    notes: { type: 'string', description: 'one sentence on anything you had to assume' },
  },
  required: ['name', 'floor', 'docks', 'utilityEntry', 'stations', 'routing', 'demandPerHour', 'notes'],
};

// Flat op object: unused fields are null. Simpler for the model than a union.
export const opsSchema = {
  type: 'object',
  properties: {
    transcript: { type: 'string', description: 'what the user said or typed, verbatim' },
    ops: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: ['move', 'rotate', 'add', 'remove', 'moveDock', 'setParam'] },
          id: { type: ['string', 'null'], description: 'station id for move, rotate, remove' },
          x: { type: ['number', 'null'] },
          y: { type: ['number', 'null'] },
          rot: { type: ['integer', 'null'], enum: [0, 90, 180, 270, null] },
          index: { type: ['integer', 'null'], description: 'dock index for moveDock' },
          wall: { type: ['string', 'null'], enum: ['N', 'S', 'E', 'W', null] },
          offset: { type: ['number', 'null'] },
          path: { type: ['string', 'null'], description: 'for setParam: demandPerHour, forklifts, costs.<key> or stations.<id>.<field>' },
          value: { type: ['number', 'null'] },
          station: { anyOf: [stationSchema, { type: 'null' }], description: 'full station for add' },
        },
        required: ['op', 'id', 'x', 'y', 'rot', 'index', 'wall', 'offset', 'path', 'value', 'station'],
      },
    },
    reason: { type: 'string', description: 'one line on what these ops do' },
  },
  required: ['transcript', 'ops', 'reason'],
};

export interface Attempt {
  attempt: number;
  ms: number;
  errors: string[];
}

export interface ElementConfidence {
  /** probability the drawn element really is what we read it as */
  confidence: number;
  /** what the Decisions API thinks the drawn element is */
  readAs: string;
  probabilities: Record<string, number>;
}

export class PipelineError extends Error {
  constructor(
    message: string,
    public attempts: Attempt[],
    public errors: ValidationError[],
  ) {
    super(message);
  }
}

export const errorText = (errs: ValidationError[]) => errs.map((e) => `- ${e.message}`).join('\n');

/** Make model output safe to validate: snap to the grid, clean ids, fill what the model does not own. */
function normalise(raw: any): FactorySpec {
  const g = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  const seen = new Set<string>();
  const stations: Station[] = (Array.isArray(raw?.stations) ? raw.stations : []).map((s: any, i: number) => {
    let id = String(s?.id ?? `s${i + 1}`).replace(/[^A-Za-z0-9_-]/g, '') || `s${i + 1}`;
    while (seen.has(id)) id += '_';
    seen.add(id);
    const rot = [0, 90, 180, 270].includes(s?.rot) ? (s.rot as Rot) : 0;
    return {
      id,
      type: String(s?.type ?? 'station').toLowerCase().trim(),
      x: snap(g(s?.x), CELL),
      y: snap(g(s?.y), CELL),
      w: Math.max(CELL, snap(g(s?.w, 1), CELL)),
      d: Math.max(CELL, snap(g(s?.d, 1), CELL)),
      rot,
      cycleTimeSec: Math.max(1, g(s?.cycleTimeSec, 60)),
      operators: Math.max(0, Math.round(g(s?.operators, 1))),
      powerKw: Math.max(0, g(s?.powerKw)),
      needsWater: Boolean(s?.needsWater),
      price: Math.max(0, g(s?.price)),
    };
  });
  const width = Math.max(CELL, snap(g(raw?.floor?.width, 20), CELL));
  const depth = Math.max(CELL, snap(g(raw?.floor?.depth, 14), CELL));
  return {
    name: String(raw?.name ?? 'Untitled plan'),
    floor: { width, depth, cellSize: CELL },
    docks: (Array.isArray(raw?.docks) ? raw.docks : []).map((d: any) => ({
      wall: (['N', 'S', 'E', 'W'].includes(d?.wall) ? d.wall : 'W') as Wall,
      offset: snap(g(d?.offset), CELL),
      kind: d?.kind === 'out' ? 'out' : 'in',
    })),
    utilityEntry: {
      power: { x: g(raw?.utilityEntry?.power?.x), y: g(raw?.utilityEntry?.power?.y) },
      water: { x: g(raw?.utilityEntry?.water?.x), y: g(raw?.utilityEntry?.water?.y) },
    },
    stations,
    routing: (Array.isArray(raw?.routing) ? raw.routing : []).map((t: unknown) => String(t).toLowerCase().trim()),
    demandPerHour: Math.max(1, g(raw?.demandPerHour, 30)),
    forklifts: 1,
    costs: DEFAULT_COSTS,
  };
}

export function toOps(raw: any[]): EditOp[] {
  return raw.map((o): EditOp => {
    switch (o?.op) {
      case 'move':
        return { op: 'move', id: String(o.id), x: snap(Number(o.x), CELL), y: snap(Number(o.y), CELL) };
      case 'rotate':
        return { op: 'rotate', id: String(o.id), rot: o.rot as Rot };
      case 'remove':
        return { op: 'remove', id: String(o.id) };
      case 'moveDock':
        return { op: 'moveDock', index: Number(o.index ?? 0), wall: o.wall as Wall, offset: snap(Number(o.offset), CELL) };
      case 'setParam':
        return { op: 'setParam', path: String(o.path), value: Number(o.value) };
      case 'add':
        return { op: 'add', station: normalise({ stations: [o.station] }).stations[0] };
      default:
        throw new Error(`Unknown op "${o?.op}"`);
    }
  });
}

/** Hydrogen: sketch photo or document -> FactorySpec, retried against validate(). */
export async function readPlan(media: Block, hint?: string, maxAttempts = MAX_ATTEMPTS) {
  const system = `You read a factory floor plan (a photo of a hand-drawn sketch, or a document describing one) and emit a FactorySpec as JSON. Never describe the layout in prose.
${GEOMETRY_RULES}
${STATION_DEFAULTS}
Read dimensions written on the plan. If the floor size is not given, assume 20 m wide by 14 m deep and place elements proportionally to where they are drawn. Use labels on the plan for ids and types. If routing is not given, order the station types as a sensible process flow. If utility entry points are not marked, put power and water on the nearest wall to the stations that need them. Put anything you assumed in notes.`;

  const first: Block[] = [media, { type: 'text', text: `Convert this plan to a FactorySpec.${hint ? `\nUser note: ${hint}` : ''}` }];
  const steps: Step[] = [{ type: 'user_input', content: first }];
  const attempts: Attempt[] = [];
  let lastErrors: ValidationError[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await interact<any>({ model: MODELS.hydrogen, input: steps, system, schema: planSchema, thinking: 'low' });
    const spec = normalise(res.json);
    lastErrors = validate(spec);
    attempts.push({ attempt, ms: res.ms, errors: lastErrors.map((e) => e.message) });
    if (!lastErrors.length) return { spec, notes: String(res.json?.notes ?? ''), attempts };
    steps.push({ type: 'model_output', content: [{ type: 'text', text: res.text }] });
    steps.push({
      type: 'user_input',
      content: [{ type: 'text', text: `That spec failed validation. Fix every error and emit the full corrected spec. Keep elements as close as possible to where they are drawn.\n${errorText(lastErrors)}` }],
    });
  }
  throw new PipelineError(`No valid layout after ${maxAttempts} attempts`, attempts, lastErrors);
}

/** Hydrogen: a typed or spoken instruction + the current spec -> edit ops, retried against validate(). */
export async function editPlan(spec: FactorySpec, command: { text?: string; audio?: Block }) {
  const system = `You edit a factory layout. You are given the current FactorySpec as JSON and one instruction (typed, or spoken in an audio clip). Emit the smallest list of edit ops that carries it out. Never describe the layout in prose.
Ops: move {id,x,y}; rotate {id,rot}; add {station}; remove {id}; moveDock {index,wall,offset}; setParam {path,value}. Set fields an op does not use to null.
${GEOMETRY_RULES}
${STATION_DEFAULTS}
"Move the dock to the north wall" means moveDock for that dock with wall "N" and an offset that keeps it clear of stations. If the instruction names a dock as inbound or outbound, use the dock index with that kind. If the instruction cannot be carried out, emit no ops and say why in reason.`;

  const content: Block[] = [{ type: 'text', text: `Current spec:\n${JSON.stringify(leanSpec(spec))}\n` }];
  if (command.audio) content.push(command.audio, { type: 'text', text: 'The instruction is in the audio clip. Transcribe it into transcript.' });
  else content.push({ type: 'text', text: `Instruction: ${command.text ?? ''}` });
  const steps: Step[] = [{ type: 'user_input', content }];
  const attempts: Attempt[] = [];
  let lastErrors: ValidationError[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await interact<any>({ model: MODELS.hydrogen, input: steps, system, schema: opsSchema, thinking: 'low' });
    const transcript = String(res.json?.transcript ?? command.text ?? '');
    const reason = String(res.json?.reason ?? '');
    let next: FactorySpec | null = null;
    let ops: EditOp[] = [];
    try {
      ops = toOps(Array.isArray(res.json?.ops) ? res.json.ops : []);
      next = applyOps(spec, ops);
      lastErrors = validate(next);
    } catch (e) {
      lastErrors = [{ code: 'param', message: (e as Error).message, ids: [] }];
    }
    attempts.push({ attempt, ms: res.ms, errors: lastErrors.map((e) => e.message) });
    if (!lastErrors.length && next) return { ops, spec: next, transcript, reason, attempts };
    steps.push({ type: 'model_output', content: [{ type: 'text', text: res.text }] });
    steps.push({
      type: 'user_input',
      content: [{ type: 'text', text: `Applying those ops to the current spec failed validation. Emit a corrected full list of ops (applied to the original spec, not to your last attempt).\n${errorText(lastErrors)}` }],
    });
  }
  throw new PipelineError(`No valid edit after ${MAX_ATTEMPTS} attempts`, attempts, lastErrors);
}

const KINDS = {
  station: 'a machine, workbench, rack or other piece of equipment drawn as a box or shape',
  dock: 'a loading door or opening on an outside wall',
  aisle: 'an empty corridor or path, or an arrow showing movement',
  other: 'a label, dimension, note, or nothing clearly drawn there',
};

/** Decisions API: for each element we read off the sketch, how sure are we that it is really there and really that kind? */
export async function scoreElements(media: Block, spec: FactorySpec): Promise<Record<string, ElementConfidence>> {
  const pct = (v: number, of: number) => Math.round((v / of) * 100);
  const where = (x: number, y: number) => `about ${pct(x, spec.floor.width)}% of the way from the left edge and ${pct(y, spec.floor.depth)}% of the way down from the top of the drawn floor outline`;
  const questions: Record<string, Question> = {};
  for (const s of spec.stations) {
    const c = centre(s);
    questions[`st_${s.id}`] = {
      type: 'choice',
      instructions: `The input is a floor plan. Look at the spot ${where(c.x, c.y)}. A reader recorded a "${s.type}" station labelled "${s.id}" there. What is actually drawn or described at that spot?`,
      criteria: KINDS,
    };
  }
  spec.docks.forEach((d, i) => {
    const p = dockPoint(spec, d);
    questions[`dock_${i}`] = {
      type: 'choice',
      instructions: `The input is a floor plan. Look at the spot on the ${{ N: 'top', S: 'bottom', E: 'right', W: 'left' }[d.wall]} wall, ${where(p.x, p.y)}. A reader recorded a loading dock there. What is actually drawn or described at that spot?`,
      criteria: KINDS,
    };
  });
  if (!Object.keys(questions).length) return {};
  const { answers } = await decide([media], questions);
  const out: Record<string, ElementConfidence> = {};
  for (const [key, a] of Object.entries(answers)) {
    if (a.type !== 'choice') continue;
    const expected = key.startsWith('dock_') ? 'dock' : 'station';
    const id = key.startsWith('dock_') ? `dock:${key.slice(5)}` : key.slice(3);
    out[id] = { confidence: a.probabilities[expected] ?? 0, readAs: a.choice, probabilities: a.probabilities };
  }
  return out;
}

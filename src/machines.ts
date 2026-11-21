// The parts catalog. A machine is a recipe (an archetype, a size, colours and a list of
// features), never a mesh. A model decides WHAT the machine has; buildParts() decides WHERE
// every part goes. Same split as the layout placer, and the same payoff: nothing a model
// says can produce a machine that is the wrong size or does not hold together.

export const TONES = ['ink', 'bone', 'steel', 'wood', 'orange', 'red', 'green', 'blue', 'yellow'] as const;
export type Tone = (typeof TONES)[number] | 'glass';
export const TONE_HEX: Record<Tone, string> = {
  ink: '#2b2d2e',
  bone: '#f6f1e7',
  steel: '#c3c5c6',
  wood: '#dcb98f',
  orange: '#e2873a',
  red: '#d1543f',
  green: '#4d9d74',
  blue: '#5b8fd6',
  yellow: '#e9b949',
  glass: '#9db8cc',
};

/** Every feature a recipe may name, with the plain description the checker is asked about. */
export const FEATURES = {
  backboard: 'a pegboard or back panel rising behind the work surface',
  overShelf: 'a shelf above the work surface',
  drawers: 'drawers',
  lowerShelf: 'a shelf underneath, near the floor',
  casters: 'wheels or casters',
  lamp: 'a built-in work light',
  vise: 'a vise or clamp mounted on the work surface',
  monitor: 'a screen or monitor',
  stool: 'a stool or seat',
  sink: 'a sink or basin',
  backsplash: 'a low raised edge along the back of the top',
  boxes: 'boxes or cartons on it',
  bins: 'small parts bins',
  powerStrip: 'a power strip or built-in sockets',
  doors: 'doors',
  worktop: 'a flat top usable as a work surface',
  meshBack: 'a wire mesh or panel back',
  controlPanel: 'a control panel with buttons or a keypad',
  window: 'a window or glass viewing panel',
  hopper: 'a hopper or funnel on top',
  stackLight: 'a signal tower light',
  duct: 'an extraction duct or chimney',
  curtain: 'a strip curtain or screen across the front',
  workTable: 'a table inside it',
  sideGuards: 'side rails or guards along its length',
  rollers: 'visible rollers (not a flat belt)',
  handle: 'a push handle',
  shelves: 'more than one deck or shelf',
  lid: 'a lid',
  pipe: 'a pipe or hose connection',
  gauge: 'a dial gauge',
  guard: 'a safety guard or fence',
  handwheel: 'a handwheel or lever',
  gripper: 'a gripper or tool on the arm',
} as const;
export type FeatureKind = keyof typeof FEATURES;

/** How a feature reads in a sentence, e.g. "pegboard back, 2 drawers, casters". */
const SHORT: Partial<Record<FeatureKind, string>> = { backboard: 'pegboard back', overShelf: 'top shelf', lowerShelf: 'lower shelf', powerStrip: 'power strip', meshBack: 'mesh back', controlPanel: 'control panel', stackLight: 'signal light', workTable: 'table inside', sideGuards: 'side guards', boxes: 'cartons', bins: 'parts bins', worktop: 'work top' };
export function featureText(features: { kind: FeatureKind; count: number }[]): string {
  return features.map((f) => `${f.count > 1 || ['drawers', 'doors', 'shelves'].includes(f.kind) ? `${f.count} ` : ''}${SHORT[f.kind] ?? f.kind}`).join(', ');
}

/** The shapes of equipment we can build, what each is, and which features it can carry. */
export const ARCHETYPES = {
  bench: { is: 'a workbench: a work surface on legs where a person works', features: ['backboard', 'overShelf', 'drawers', 'lowerShelf', 'casters', 'lamp', 'vise', 'monitor', 'stool', 'boxes', 'bins', 'powerStrip'] },
  table: { is: 'a plain table or prep table, possibly with a sink', features: ['lowerShelf', 'casters', 'sink', 'backsplash', 'boxes', 'bins', 'drawers'] },
  rack: { is: 'open shelving or pallet racking: uprights with several shelf levels', features: ['boxes', 'bins', 'casters', 'meshBack'] },
  cabinet: { is: 'a closed storage cabinet or tool chest with doors or drawers', features: ['doors', 'drawers', 'worktop', 'casters'] },
  machine: { is: 'an enclosed machine: a housed body that does a process', features: ['controlPanel', 'window', 'hopper', 'stackLight', 'duct', 'doors'] },
  enclosure: { is: 'a booth or cell a person or part goes into: three walls and an open front', features: ['curtain', 'duct', 'workTable', 'lamp', 'window', 'controlPanel'] },
  conveyor: { is: 'a conveyor: a long bed that carries items along', features: ['sideGuards', 'rollers', 'boxes', 'controlPanel'] },
  cart: { is: 'a cart or trolley: a deck on wheels', features: ['handle', 'shelves', 'boxes'] },
  tank: { is: 'a tank, drum or vessel: a round container on legs', features: ['lid', 'pipe', 'gauge'] },
  press: { is: 'a column machine such as a drill press or arbor press: base, column and head', features: ['handwheel', 'guard', 'controlPanel'] },
  kiosk: { is: 'a pedestal unit such as a scale, label printer or test stand', features: ['monitor', 'controlPanel', 'stackLight', 'lowerShelf'] },
  robot: { is: 'a robot arm on a base', features: ['gripper', 'guard', 'controlPanel'] },
} as const satisfies Record<string, { is: string; features: readonly FeatureKind[] }>;
export type Archetype = keyof typeof ARCHETYPES;
export const ARCHETYPE_NAMES = Object.keys(ARCHETYPES) as Archetype[];

export interface MachineRecipe {
  archetype: Archetype;
  /** overall envelope in metres: w along the front, d front to back, h floor to highest point */
  size: { w: number; d: number; h: number };
  /** height of the work surface or bed, for bench, table and conveyor */
  workHeight?: number;
  /** shelf levels, for rack */
  levels?: number;
  colors: { frame: Tone; surface: Tone; body: Tone; accent: Tone };
  features: { kind: FeatureKind; count: number }[];
  /** the face a person works at; the front is +d */
  operatorSide: 'front' | 'back' | 'left' | 'right' | 'none';
}

export interface Part {
  shape: 'box' | 'cyl' | 'cone';
  /** box: x, y, z. cyl: diameter, height, diameter. cone: top diameter, height, bottom diameter */
  size: [number, number, number];
  /** centre; y is up from the floor, z is toward the front */
  at: [number, number, number];
  tone: Tone;
  rot?: [number, number, number];
  opacity?: number;
  glow?: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (v: number) => Math.round(v * 100) / 100;
/** how far features that rise above a work surface need */
const ABOVE = 0.3;
const DRAWER = 0.14;
/** cabinet drawers shrink to fit, down to this */
const MIN_DRAWER = 0.07;
const TALL: FeatureKind[] = ['backboard', 'overShelf', 'lamp', 'monitor'];

/** Make any object into a well-formed recipe: known archetype and tones, numeric sizes, deduped features. */
export function normaliseRecipe(raw: any): MachineRecipe {
  const num = (v: unknown, f: number) => (typeof v === 'number' && Number.isFinite(v) ? v : f);
  const tone = (v: unknown, f: Tone): Tone => ((TONES as readonly string[]).includes(v as string) ? (v as Tone) : f);
  const archetype: Archetype = ARCHETYPE_NAMES.includes(raw?.archetype) ? raw.archetype : 'machine';
  const seen = new Set<string>();
  const features: MachineRecipe['features'] = [];
  for (const f of Array.isArray(raw?.features) ? raw.features : []) {
    const kind = f?.kind as FeatureKind;
    if (!(kind in FEATURES) || seen.has(kind)) continue;
    seen.add(kind);
    features.push({ kind, count: clamp(Math.round(num(f?.count, 1)), 1, 8) });
  }
  const size = raw?.size ?? raw ?? {};
  const side = ['front', 'back', 'left', 'right', 'none'].includes(raw?.operatorSide) ? raw.operatorSide : 'front';
  return {
    archetype,
    size: { w: round2(num(size.w, 1.5)), d: round2(num(size.d, 0.8)), h: round2(num(size.h, 1)) },
    workHeight: typeof raw?.workHeight === 'number' && raw.workHeight > 0 ? round2(raw.workHeight) : undefined,
    levels: typeof raw?.levels === 'number' && raw.levels > 0 ? Math.round(raw.levels) : undefined,
    colors: {
      frame: tone(raw?.colors?.frame ?? raw?.frame, 'ink'),
      surface: tone(raw?.colors?.surface ?? raw?.surface, 'wood'),
      body: tone(raw?.colors?.body ?? raw?.body, 'bone'),
      accent: tone(raw?.colors?.accent ?? raw?.accent, 'orange'),
    },
    features,
    operatorSide: side,
  };
}

/**
 * Code, not a model, decides whether a recipe can be built. Every message says what is wrong
 * and what would fix it, because these go straight back to the model that wrote the recipe.
 */
export function checkRecipe(r: MachineRecipe): string[] {
  const errs: string[] = [];
  const { w, d, h } = r.size;
  if (!(w >= 0.3 && w <= 12)) errs.push(`width ${w} m is outside 0.3 to 12 m`);
  if (!(d >= 0.3 && d <= 12)) errs.push(`depth ${d} m is outside 0.3 to 12 m`);
  if (!(h >= 0.3 && h <= 5)) errs.push(`height ${h} m is outside 0.3 to 5 m`);
  const allowed = ARCHETYPES[r.archetype].features as readonly FeatureKind[];
  for (const f of r.features) {
    if (!allowed.includes(f.kind)) errs.push(`a ${r.archetype} cannot have "${f.kind}". It can have: ${allowed.join(', ')}. Drop the feature, or pick an archetype that has it`);
  }
  const has = (k: FeatureKind) => r.features.find((f) => f.kind === k);
  if (r.archetype === 'bench' || r.archetype === 'table') {
    const top = r.workHeight ?? Math.min(0.9, h);
    if (!(top >= 0.5 && top <= 1.3)) errs.push(`workHeight ${top} m is outside 0.5 to 1.3 m for a ${r.archetype}`);
    if (top > h + 1e-6) errs.push(`workHeight ${top} m is above the overall height ${h} m`);
    const tall = r.features.filter((f) => TALL.includes(f.kind)).map((f) => f.kind);
    if (tall.length && h - top < ABOVE - 1e-6) {
      errs.push(`${tall.join(', ')} rise${tall.length > 1 ? '' : 's'} above the work surface, so the overall height must be at least ${ABOVE} m more than workHeight (now ${round2(h - top)} m more). Raise h to the top of the tallest part, or drop ${tall.length > 1 ? 'them' : 'it'}`);
    }
    const drawers = has('drawers');
    if (drawers && drawers.count * DRAWER > top - 0.2 + 1e-6) errs.push(`${drawers.count} drawers need ${round2(drawers.count * DRAWER + 0.2)} m under the top, but workHeight is ${top} m. Use at most ${Math.max(0, Math.floor((top - 0.2) / DRAWER))}`);
  }
  if (r.archetype === 'conveyor') {
    const bed = r.workHeight ?? h * 0.75;
    if (!(bed >= 0.2 && bed <= h + 1e-6)) errs.push(`workHeight ${bed} m (the bed) must be between 0.2 m and the overall height ${h} m`);
    if (w < d) errs.push(`a conveyor's w is its length: w (${w} m) must be at least d (${d} m)`);
  }
  if (r.archetype === 'rack') {
    const levels = r.levels ?? Math.round(h / 0.6);
    if (!(levels >= 2 && levels <= 7)) errs.push(`levels ${levels} is outside 2 to 7 for a rack`);
    if (h / levels < 0.25) errs.push(`${levels} levels in ${h} m leaves ${round2(h / levels)} m per level; use fewer levels or a taller rack`);
  }
  if (r.archetype === 'cabinet') {
    const drawers = has('drawers');
    if (drawers && drawers.count * MIN_DRAWER > h - 0.2) errs.push(`${drawers.count} drawers do not fit in a cabinet ${h} m tall. Use at most ${Math.max(0, Math.floor((h - 0.2) / MIN_DRAWER))}`);
  }
  if (r.archetype === 'enclosure' && h < 1.6) errs.push(`an enclosure is something a person or part goes into: height ${h} m is under 1.6 m. Use machine or cabinet for something this low`);
  return errs;
}

/** Deterministic last resort: drop what cannot be built and clamp the rest, so there is always a valid recipe. */
export function repairRecipe(r: MachineRecipe): { recipe: MachineRecipe; dropped: FeatureKind[] } {
  const allowed = ARCHETYPES[r.archetype].features as readonly FeatureKind[];
  const out: MachineRecipe = { ...r, size: { w: clamp(r.size.w, 0.3, 12), d: clamp(r.size.d, 0.3, 12), h: clamp(r.size.h, r.archetype === 'enclosure' ? 1.6 : 0.3, 5) }, features: [...r.features] };
  const dropped: FeatureKind[] = [];
  const drop = (pred: (k: FeatureKind) => boolean) => {
    out.features = out.features.filter((f) => {
      if (!pred(f.kind)) return true;
      dropped.push(f.kind);
      return false;
    });
  };
  drop((k) => !allowed.includes(k));
  if (out.archetype === 'bench' || out.archetype === 'table') {
    const top = clamp(out.workHeight ?? Math.min(0.9, out.size.h), 0.5, Math.min(1.3, Math.max(0.5, out.size.h)));
    out.workHeight = top;
    out.size.h = Math.max(out.size.h, top);
    if (out.size.h - top < ABOVE) drop((k) => TALL.includes(k));
    out.features = out.features.map((f) => (f.kind === 'drawers' ? { ...f, count: clamp(f.count, 1, Math.max(1, Math.floor((top - 0.2) / DRAWER))) } : f));
  }
  if (out.archetype === 'conveyor') {
    out.workHeight = clamp(out.workHeight ?? out.size.h * 0.75, 0.2, out.size.h);
    if (out.size.w < out.size.d) [out.size.w, out.size.d] = [out.size.d, out.size.w];
  }
  if (out.archetype === 'rack') out.levels = clamp(out.levels ?? Math.round(out.size.h / 0.6), 2, Math.max(2, Math.min(7, Math.floor(out.size.h / 0.25))));
  if (out.archetype === 'cabinet') out.features = out.features.map((f) => (f.kind === 'drawers' ? { ...f, count: clamp(f.count, 1, Math.max(1, Math.floor((out.size.h - 0.2) / MIN_DRAWER))) } : f));
  return { recipe: out, dropped };
}

// ---------- builder ----------

type P = Part[];
const box = (x: number, y: number, z: number, at: [number, number, number], tone: Tone, extra: Partial<Part> = {}): Part => ({ shape: 'box', size: [x, y, z], at, tone, ...extra });
const cyl = (dia: number, height: number, at: [number, number, number], tone: Tone, extra: Partial<Part> = {}): Part => ({ shape: 'cyl', size: [dia, height, dia], at, tone, ...extra });

function legs(p: P, w: number, d: number, height: number, tone: Tone, t = 0.06) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(box(t, height, t, [sx * (w / 2 - t / 2), height / 2, sz * (d / 2 - t / 2)], tone));
}
function casters(p: P, w: number, d: number) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(cyl(0.1, 0.07, [sx * (w / 2 - 0.07), 0.035, sz * (d / 2 - 0.07)], 'ink'));
}
function cartons(p: P, w: number, d: number, y: number, maxH: number, x0 = 0) {
  const hh = Math.min(maxH, 0.3);
  if (hh < 0.06) return;
  p.push(box(Math.min(0.5, w * 0.26), hh, d * 0.6, [x0 - w * 0.24, y + hh / 2, 0], 'wood'));
  p.push(box(Math.min(0.4, w * 0.2), hh * 0.7, d * 0.5, [x0 + w * 0.04, y + (hh * 0.7) / 2, d * 0.04], 'bone'));
  p.push(box(Math.min(0.45, w * 0.22), hh * 0.85, d * 0.55, [x0 + w * 0.3, y + (hh * 0.85) / 2, -d * 0.03], 'wood'));
}
function binRow(p: P, w: number, y: number, z: number, accent: Tone) {
  const k = clamp(Math.floor(w / 0.24), 2, 8);
  const tones: Tone[] = [accent, 'blue', 'yellow', 'green', 'red'];
  for (let i = 0; i < k; i++) p.push(box(0.16, 0.11, 0.14, [-w / 2 + 0.14 + (i * (w - 0.28)) / Math.max(1, k - 1), y + 0.055, z], tones[i % tones.length]));
}
function panel(p: P, at: [number, number, number], zFace = 1) {
  p.push(box(0.3, 0.26, 0.1, at, 'ink'));
  p.push(box(0.06, 0.06, 0.02, [at[0] - 0.07, at[1] + 0.04, at[2] + zFace * 0.06], 'green'));
  p.push(box(0.06, 0.06, 0.02, [at[0] + 0.07, at[1] + 0.04, at[2] + zFace * 0.06], 'red'));
}
function stack(p: P, x: number, z: number, y0: number, room: number) {
  const seg = Math.min(0.09, room / 4);
  p.push(cyl(0.03, seg, [x, y0 + seg / 2, z], 'steel'));
  (['green', 'yellow', 'red'] as Tone[]).forEach((t, i) => p.push(cyl(0.08, seg, [x, y0 + seg * (1.5 + i), z], t, { glow: true })));
}

/** A recipe turned into positioned parts, standing on y = 0 and centred on the origin. Pure and deterministic. */
export function buildParts(r: MachineRecipe): Part[] {
  const { w, d, h } = r.size;
  const c = r.colors;
  const p: P = [];
  const has = (k: FeatureKind) => r.features.find((f) => f.kind === k);
  const count = (k: FeatureKind, fallback = 1) => has(k)?.count ?? fallback;

  switch (r.archetype) {
    case 'bench':
    case 'table': {
      const top = clamp(r.workHeight ?? Math.min(0.9, h), 0.3, h);
      const above = h - top;
      legs(p, w, d, top - 0.06, c.frame);
      p.push(box(w, 0.06, d, [0, top - 0.03, 0], c.surface));
      if (has('lowerShelf')) p.push(box(w - 0.14, 0.04, d - 0.14, [0, Math.min(0.22, top * 0.3), 0], 'steel'));
      if (has('casters')) casters(p, w, d);
      if (has('drawers')) {
        const k = Math.min(count('drawers'), Math.max(1, Math.floor((top - 0.2) / DRAWER)));
        const bw = Math.min(0.5, w * 0.42);
        for (let i = 0; i < k; i++) {
          const y = top - 0.06 - DRAWER / 2 - i * DRAWER;
          p.push(box(bw, DRAWER - 0.02, d * 0.82, [w / 2 - bw / 2 - 0.07, y, 0.01], c.body));
          p.push(box(bw * 0.5, 0.02, 0.02, [w / 2 - bw / 2 - 0.07, y, d * 0.41 + 0.02], 'ink'));
        }
      }
      const tall = above >= ABOVE - 1e-6;
      if (has('backboard') && tall) p.push(box(w, above, 0.04, [0, top + above / 2, -d / 2 + 0.02], c.accent));
      if (has('overShelf') && tall) {
        const sd = Math.min(0.32, d * 0.5);
        p.push(box(w, 0.04, sd, [0, h - 0.02, -d / 2 + sd / 2], c.surface));
        if (!has('backboard')) for (const sx of [-1, 1]) p.push(box(0.05, above, 0.05, [sx * (w / 2 - 0.025), top + above / 2, -d / 2 + 0.025], c.frame));
      }
      if (has('lamp') && tall) {
        p.push(box(w * 0.6, 0.03, 0.07, [0, h - 0.07, -d / 2 + 0.2], 'yellow', { glow: true }));
        if (!has('backboard') && !has('overShelf')) p.push(box(0.04, above, 0.04, [0, top + above / 2, -d / 2 + 0.03], c.frame));
      }
      if (has('bins')) binRow(p, w, tall && has('backboard') ? top + Math.min(above - 0.16, 0.36) : top, -d / 2 + (tall && has('backboard') ? 0.11 : 0.12), c.accent);
      if (has('monitor') && tall) {
        p.push(box(0.05, 0.1, 0.05, [-w * 0.2, top + 0.05, -d / 2 + 0.16], 'ink'));
        p.push(box(Math.min(0.42, w * 0.4), Math.min(0.26, above - 0.04), 0.03, [-w * 0.2, top + 0.1 + Math.min(0.26, above - 0.04) / 2 - 0.06, -d / 2 + 0.16], 'ink'));
      }
      if (has('backsplash')) p.push(box(w, 0.14, 0.03, [0, top + 0.07, -d / 2 + 0.015], c.surface));
      if (has('sink')) {
        p.push(box(Math.min(0.5, w * 0.3), 0.02, d * 0.5, [w * 0.22, top + 0.005, 0.02], 'ink'));
        p.push(cyl(0.03, 0.18, [w * 0.22, top + 0.09, -d * 0.3], 'steel'));
      }
      if (has('vise')) {
        p.push(box(0.16, 0.1, 0.2, [-w / 2 + 0.16, top + 0.05, d / 2 - 0.13], 'steel'));
        p.push(box(0.18, 0.05, 0.06, [-w / 2 + 0.16, top + 0.125, d / 2 - 0.08], 'ink'));
      }
      if (has('powerStrip')) p.push(box(w * 0.45, 0.04, 0.05, [w * 0.12, top + 0.02, -d / 2 + 0.08], 'ink'));
      if (has('boxes')) {
        const x = has('sink') ? -w * 0.2 : w * 0.12;
        p.push(box(Math.min(0.4, w * 0.22), 0.16, d * 0.42, [x, top + 0.08, 0.03], 'wood'));
        p.push(box(Math.min(0.28, w * 0.15), 0.1, d * 0.3, [x - Math.min(0.4, w * 0.24), top + 0.05, d * 0.1], 'bone'));
      }
      if (has('stool')) {
        p.push(cyl(0.06, 0.48, [-w * 0.08, 0.24, d / 2 + 0.3], 'steel'));
        p.push(cyl(0.32, 0.05, [-w * 0.08, 0.5, d / 2 + 0.3], 'ink'));
      }
      break;
    }
    case 'rack': {
      const levels = clamp(r.levels ?? Math.round(h / 0.6), 2, 7);
      legs(p, w, d, h, c.frame, 0.07);
      const pitch = (h - 0.14) / levels;
      for (let i = 0; i < levels; i++) {
        const y = 0.12 + i * pitch;
        p.push(box(w, 0.04, d, [0, y, 0], 'steel'));
        if (has('boxes')) cartons(p, w, d, y + 0.02, pitch - 0.1);
        else if (has('bins') && pitch > 0.2) binRow(p, w, y + 0.02, d / 2 - 0.1, c.accent);
      }
      if (has('meshBack')) p.push(box(w, h - 0.1, 0.02, [0, h / 2, -d / 2 + 0.01], 'steel', { opacity: 0.45 }));
      if (has('casters')) casters(p, w, d);
      break;
    }
    case 'cabinet': {
      const base = has('casters') ? 0.09 : 0.04;
      const top = has('worktop') ? 0.05 : 0;
      const bodyH = h - base - top;
      p.push(box(w, bodyH, d, [0, base + bodyH / 2, 0], c.body));
      if (has('worktop')) p.push(box(w + 0.04, 0.05, d + 0.04, [0, h - 0.025, 0], c.surface));
      if (has('casters')) casters(p, w, d);
      // drawers fill the body when there are no doors, and take the top part when there are
      const nd = has('drawers') ? count('drawers') : 0;
      const zone = has('doors') ? Math.min(bodyH * 0.45, nd * DRAWER) : bodyH - 0.06;
      const dh = nd ? clamp(zone / nd, MIN_DRAWER * 0.8, 0.3) : 0;
      for (let i = 0; i < nd; i++) {
        const y = base + bodyH - 0.03 - dh / 2 - i * dh;
        if (y - dh / 2 < base) break;
        p.push(box(w - 0.06, dh - 0.02, 0.02, [0, y, d / 2 + 0.01], c.accent));
        p.push(box(Math.min(0.3, w * 0.4), 0.015, 0.02, [0, y, d / 2 + 0.03], 'ink'));
      }
      const doorH = bodyH - 0.1 - nd * dh;
      if (has('doors') && doorH > 0.2) {
        const k = clamp(count('doors'), 1, 4);
        const dw = (w - 0.06) / k;
        for (let i = 0; i < k; i++) {
          const x = -w / 2 + 0.03 + dw * (i + 0.5);
          p.push(box(dw - 0.02, doorH, 0.02, [x, base + 0.04 + doorH / 2, d / 2 + 0.01], c.surface));
          p.push(box(0.02, Math.min(0.2, doorH * 0.3), 0.02, [x + (i % 2 === 0 ? 1 : -1) * (dw / 2 - 0.06), base + 0.04 + doorH * 0.55, d / 2 + 0.03], 'ink'));
        }
      }
      break;
    }
    case 'machine': {
      const room = has('hopper') || has('stackLight') || has('duct') ? Math.min(0.4, h * 0.22) : 0;
      const top = h - room;
      const bodyH = top - 0.18;
      p.push(box(w, 0.1, d, [0, 0.05, 0], 'ink'));
      p.push(box(w * 0.96, bodyH, d * 0.94, [0, 0.1 + bodyH / 2, 0], c.body));
      p.push(box(w * 0.96, 0.08, d * 0.94, [0, top - 0.04, 0], c.accent));
      const face = (d * 0.94) / 2;
      if (has('window')) p.push(box(w * 0.4, bodyH * 0.34, 0.03, [-w * 0.18, 0.1 + bodyH * 0.66, face + 0.015], 'glass'));
      if (has('doors')) p.push(box(w * 0.4, bodyH * (has('window') ? 0.4 : 0.8), 0.02, [-w * 0.18, 0.1 + bodyH * (has('window') ? 0.24 : 0.46), face + 0.01], c.surface));
      if (has('controlPanel')) panel(p, [w * 0.28, clamp(0.1 + bodyH * 0.7, 0.3, 1.3), face + 0.05]);
      if (has('hopper')) p.push({ shape: 'cone', size: [Math.min(w, d) * 0.5, room - 0.02, Math.min(w, d) * 0.16], at: [-w * 0.2, top + (room - 0.02) / 2, 0], tone: 'steel' });
      if (has('duct')) p.push(cyl(Math.min(0.3, Math.min(w, d) * 0.3), room, [w * 0.12, top + room / 2, -d * 0.2], 'steel'));
      if (has('stackLight')) stack(p, w * 0.38, -d * 0.32, top, room);
      break;
    }
    case 'enclosure': {
      const room = has('duct') ? Math.min(0.35, h * 0.15) : 0;
      const top = h - room;
      const t = 0.05;
      p.push(box(w, 0.04, d, [0, 0.02, 0], 'steel'));
      p.push(box(w, top, t, [0, top / 2, -d / 2 + t / 2], c.body));
      for (const sx of [-1, 1]) {
        p.push(box(t, top, d, [sx * (w / 2 - t / 2), top / 2, 0], c.body));
        p.push(box(0.08, top, 0.08, [sx * (w / 2 - 0.04), top / 2, d / 2 - 0.04], c.frame));
      }
      p.push(box(w, 0.08, 0.08, [0, top - 0.04, d / 2 - 0.04], c.frame));
      if (has('window')) p.push(box(0.02, top * 0.3, d * 0.5, [w / 2 - 0.01, top * 0.6, 0], 'glass'));
      if (has('curtain')) {
        const k = Math.max(2, Math.floor((w * 0.5) / 0.22));
        for (let i = 0; i < k; i++) p.push(box(0.19, top * 0.78, 0.015, [-w / 2 + 0.2 + i * 0.22, top - 0.08 - top * 0.39, d / 2 - 0.02], c.accent, { opacity: 0.55 }));
      }
      if (has('workTable')) {
        const tw = w * 0.5;
        const td = d * 0.4;
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(box(0.05, 0.8, 0.05, [sx * (tw / 2 - 0.03), 0.4, -d * 0.12 + sz * (td / 2 - 0.03)], c.frame));
        p.push(box(tw, 0.05, td, [0, 0.825, -d * 0.12], 'steel'));
      }
      if (has('lamp')) p.push(box(w * 0.5, 0.04, 0.08, [0, top - 0.12, -d * 0.1], 'yellow', { glow: true }));
      if (has('controlPanel')) panel(p, [w / 2 - 0.24, 1.2, d / 2 - 0.1]);
      if (has('duct')) p.push(cyl(Math.min(0.35, w * 0.2), room + 0.3, [w * 0.25, top + room / 2 - 0.15, -d / 2 + 0.25], 'steel'));
      break;
    }
    case 'conveyor': {
      const guard = has('sideGuards') ? 0.1 : 0;
      const bed = clamp(r.workHeight ?? h * 0.75, 0.2, h - guard);
      const pairs = Math.max(2, Math.round(w / 1.2) + 1);
      for (let i = 0; i < pairs; i++) {
        const x = -w / 2 + 0.06 + (i * (w - 0.12)) / (pairs - 1);
        for (const sz of [-1, 1]) p.push(box(0.05, bed - 0.1, 0.05, [x, (bed - 0.1) / 2, sz * (d / 2 - 0.04)], c.frame));
      }
      p.push(box(w, 0.1, d, [0, bed - 0.05, 0], c.body));
      if (has('rollers')) {
        const k = clamp(Math.floor(w / 0.14), 3, 30);
        for (let i = 0; i < k; i++) p.push(cyl(0.07, d * 0.86, [-w / 2 + 0.08 + (i * (w - 0.16)) / (k - 1), bed - 0.03, 0], 'steel', { rot: [Math.PI / 2, 0, 0] }));
      } else p.push(box(w, 0.02, d * 0.86, [0, bed + 0.005, 0], 'ink'));
      if (guard) for (const sz of [-1, 1]) p.push(box(w, guard, 0.03, [0, bed + guard / 2, sz * (d / 2 - 0.015)], c.accent));
      if (has('boxes')) cartons(p, w * 0.8, d * 0.9, bed + 0.01, Math.min(0.22, Math.max(0, h - bed) + 0.22));
      if (has('controlPanel')) panel(p, [-w / 2 + 0.3, Math.max(0.2, bed * 0.55), d / 2 + 0.05]);
      break;
    }
    case 'cart': {
      casters(p, w, d);
      const decks = has('shelves') ? clamp(count('shelves', 2), 2, 4) : 1;
      const span = h - 0.2;
      for (let i = 0; i < decks; i++) p.push(box(w, 0.05, d, [0, 0.12 + (decks === 1 ? 0 : (i * (span - 0.3)) / (decks - 1)), 0], i === 0 ? c.body : c.surface));
      if (decks > 1) for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(box(0.04, span - 0.2, 0.04, [sx * (w / 2 - 0.03), 0.12 + (span - 0.2) / 2, sz * (d / 2 - 0.03)], c.frame));
      if (has('handle')) {
        for (const sz of [-1, 1]) p.push(box(0.04, h - 0.14, 0.04, [-w / 2 + 0.02, 0.14 + (h - 0.14) / 2, sz * (d / 2 - 0.05)], c.frame));
        p.push(box(0.04, 0.04, d - 0.06, [-w / 2 + 0.02, h - 0.02, 0], c.accent));
      }
      if (has('boxes')) cartons(p, w * 0.85, d * 0.9, 0.15, Math.min(0.3, h - 0.3));
      break;
    }
    case 'tank': {
      const dia = Math.min(w, d);
      const legH = Math.min(0.4, h * 0.2);
      const lid = has('lid') ? 0.08 : 0;
      const bodyH = h - legH - lid;
      for (let i = 0; i < 3; i++) {
        const a = (i * 2 * Math.PI) / 3 + Math.PI / 6;
        p.push(box(0.07, legH, 0.07, [Math.cos(a) * dia * 0.36, legH / 2, Math.sin(a) * dia * 0.36], c.frame));
      }
      p.push(cyl(dia * 0.92, bodyH, [0, legH + bodyH / 2, 0], c.body));
      p.push(cyl(dia * 0.95, 0.05, [0, legH + bodyH * 0.5, 0], c.accent));
      if (lid) p.push(cyl(dia * 0.96, lid, [0, h - lid / 2, 0], c.accent));
      if (has('gauge')) p.push(cyl(0.16, 0.04, [0, legH + bodyH * 0.7, dia * 0.46], 'bone', { rot: [Math.PI / 2, 0, 0] }));
      if (has('pipe')) p.push(cyl(0.07, bodyH * 0.7, [dia * 0.44, legH + bodyH * 0.35, -dia * 0.12], 'steel'));
      break;
    }
    case 'press': {
      const zc = -d / 2 + d * 0.32;
      p.push(box(w, 0.1, d, [0, 0.05, 0], 'ink'));
      p.push(box(Math.min(0.3, w * 0.3), h - 0.1, d * 0.24, [0, 0.1 + (h - 0.1) / 2, -d / 2 + d * 0.12], c.frame));
      p.push(box(w * 0.55, h * 0.2, d * 0.6, [0, h - h * 0.1, zc], c.body));
      p.push(box(w * 0.7, 0.06, d * 0.55, [0, h * 0.45, zc + 0.03], c.surface));
      p.push(cyl(0.06, h * 0.2, [0, h * 0.7, zc + d * 0.1], 'steel'));
      if (has('handwheel')) p.push(cyl(Math.min(0.3, h * 0.2), 0.03, [w * 0.275 + 0.03, h * 0.86, zc], c.accent, { rot: [0, 0, Math.PI / 2] }));
      if (has('guard')) p.push(box(w * 0.5, h * 0.22, 0.02, [0, h * 0.64, zc + d * 0.28], 'glass', { opacity: 0.5 }));
      if (has('controlPanel')) p.push(box(0.16, 0.2, 0.06, [-w * 0.18, h * 0.9, zc + d * 0.3 + 0.03], 'ink'));
      break;
    }
    case 'kiosk': {
      const head = 0.06 + h * 0.5;
      const headH = h * 0.2;
      const room = h - head - headH;
      p.push(box(w * 0.8, 0.06, d * 0.8, [0, 0.03, 0], 'ink'));
      p.push(box(w * 0.5, h * 0.5, d * 0.5, [0, 0.06 + h * 0.25, 0], c.body));
      p.push(box(w * 0.92, headH, d * 0.72, [0, head + headH / 2, 0], c.surface));
      if (has('lowerShelf')) p.push(box(w * 0.8, 0.04, d * 0.8, [0, Math.min(0.3, h * 0.25), 0], 'steel'));
      if (has('monitor') && room > 0.08) p.push(box(w * 0.6, room - 0.02, 0.03, [-w * 0.1, head + headH + (room - 0.02) / 2, -d * 0.2], 'ink'));
      if (has('controlPanel')) {
        p.push(box(w * 0.34, 0.03, d * 0.26, [w * 0.2, head + headH + 0.015, d * 0.16], 'ink'));
        p.push(box(0.05, 0.02, 0.05, [w * 0.14, head + headH + 0.04, d * 0.16], 'green'));
        p.push(box(0.05, 0.02, 0.05, [w * 0.26, head + headH + 0.04, d * 0.16], 'red'));
      }
      if (has('stackLight') && room > 0.12) stack(p, w * 0.36, -d * 0.24, head + headH, room);
      break;
    }
    case 'robot': {
      const m = Math.min(w, d);
      const ped = h * 0.3;
      p.push(box(m * 0.5, ped, m * 0.5, [0, ped / 2, 0], 'ink'));
      p.push(cyl(m * 0.4, 0.1, [0, ped + 0.05, 0], c.accent));
      const upper = h - ped - 0.1 - 0.14;
      p.push(box(0.14, upper, 0.14, [0, ped + 0.1 + upper / 2, 0], c.body));
      p.push(cyl(0.2, 0.16, [0, h - 0.1, 0], c.accent, { rot: [0, 0, Math.PI / 2] }));
      const reach = Math.min(d * 0.42, 0.9);
      p.push(box(0.12, 0.12, reach, [0, h - 0.1, reach / 2], c.body));
      if (has('gripper')) for (const sx of [-1, 1]) p.push(box(0.03, 0.16, 0.05, [sx * 0.05, h - 0.2, reach - 0.03], 'ink'));
      if (has('guard')) {
        p.push(box(w, Math.min(0.9, h * 0.6), 0.03, [0, Math.min(0.9, h * 0.6) / 2, -d / 2 + 0.015], 'yellow', { opacity: 0.5 }));
        for (const sx of [-1, 1]) p.push(box(0.03, Math.min(0.9, h * 0.6), d * 0.6, [sx * (w / 2 - 0.015), Math.min(0.9, h * 0.6) / 2, -d * 0.2], 'yellow', { opacity: 0.5 }));
      }
      if (has('controlPanel')) p.push(box(0.3, Math.min(0.6, h * 0.4), 0.22, [-w / 2 + 0.17, Math.min(0.6, h * 0.4) / 2, -d / 2 + 0.14], 'bone'));
      break;
    }
  }
  return p;
}

/** The space the parts actually occupy, ignoring rotation (rotated parts are small). */
export function partsBounds(parts: Part[]) {
  const b = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
  for (const q of parts) {
    b.minX = Math.min(b.minX, q.at[0] - q.size[0] / 2);
    b.maxX = Math.max(b.maxX, q.at[0] + q.size[0] / 2);
    b.minY = Math.min(b.minY, q.at[1] - q.size[1] / 2);
    b.maxY = Math.max(b.maxY, q.at[1] + q.size[1] / 2);
    b.minZ = Math.min(b.minZ, q.at[2] - q.size[2] / 2);
    b.maxZ = Math.max(b.maxZ, q.at[2] + q.size[2] / 2);
  }
  return b;
}

const f = (...kinds: FeatureKind[]) => kinds.map((kind) => ({ kind, count: kind === 'drawers' ? 2 : 1 }));

/** The house recipe for a step type, used for built-in catalog items and anything without a recipe of its own. */
export function defaultRecipe(type: string, size: { w: number; d: number; h: number }, shape?: string): MachineRecipe {
  const base = (archetype: Archetype, features: MachineRecipe['features'], colors: Partial<MachineRecipe['colors']> = {}, extra: Partial<MachineRecipe> = {}): MachineRecipe => {
    const r: MachineRecipe = { archetype, size: { ...size }, colors: { frame: 'ink', surface: 'wood', body: 'bone', accent: 'orange', ...colors }, features, operatorSide: 'front', ...extra };
    return repairRecipe(r).recipe;
  };
  const bench = (h: number) => ({ ...size, h: Math.max(size.h, h) });
  switch (type) {
    case 'storage':
      return base('rack', f('boxes'), { frame: 'orange' });
    case 'prep':
      return base('table', f('sink', 'lowerShelf', 'backsplash'), { surface: 'steel', accent: 'green' }, { workHeight: Math.min(0.9, size.h) });
    case 'assembly':
      return { ...base('bench', f('backboard', 'overShelf', 'bins', 'lamp', 'stool', 'drawers'), {}, { size: bench(1.5), workHeight: 0.9 }) };
    case 'kitting':
      return base('bench', f('backboard', 'bins', 'lowerShelf'), { accent: 'yellow' }, { size: bench(1.4), workHeight: 0.9 });
    case 'inspect':
      return base('bench', f('lamp', 'monitor', 'stool'), { surface: 'bone', accent: 'green' }, { size: bench(1.4), workHeight: 0.9 });
    case 'test':
      return base('machine', f('controlPanel', 'window', 'stackLight'), { accent: 'red' }, { size: { ...size, h: Math.max(size.h, 1.3) } });
    case 'pack':
      return base('table', f('boxes', 'lowerShelf'), { surface: 'bone', accent: 'wood' }, { workHeight: Math.min(0.9, size.h) });
    case 'weld':
      return base('enclosure', f('curtain', 'duct', 'workTable'), { body: 'steel', accent: 'red' }, { size: { ...size, h: Math.max(size.h, 2) } });
    case 'paint':
      return base('enclosure', f('duct', 'lamp', 'window'), { body: 'bone', accent: 'blue' }, { size: { ...size, h: Math.max(size.h, 2.2) } });
    case 'label':
      return base('kiosk', f('monitor', 'controlPanel'), { accent: 'yellow', surface: 'steel' });
    case 'conveyor':
      return base('conveyor', f('rollers', 'sideGuards'), { body: 'steel', accent: 'blue' });
    default: {
      const archetype: Archetype = shape === 'rack' ? 'rack' : shape === 'bench' ? 'bench' : shape === 'table' ? 'table' : shape === 'conveyor' ? 'conveyor' : 'machine';
      return base(archetype, archetype === 'machine' ? f('controlPanel', 'stackLight') : [], {}, archetype === 'machine' ? { size: { ...size, h: Math.max(size.h, 1.2) } } : {});
    }
  }
}

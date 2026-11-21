// Free-form machine models. Where a recipe (src/machines.ts) picks from fixed archetypes,
// a MachineModel is whatever part list an agent designs: any shapes, real materials, motion.
// That freedom is why the checks here matter. A model is only shown once code has confirmed
// it fits its envelope and that every part is connected to the ground through other parts.

export const MATERIALS = {
  paintWhite: { color: '#d8dde3', metalness: 0.22, roughness: 0.36, is: 'off-white painted sheet metal (machine cabinets)' },
  paintGrey: { color: '#8a929b', metalness: 0.25, roughness: 0.45, is: 'mid-grey painted metal' },
  paintCharcoal: { color: '#262c35', metalness: 0.4, roughness: 0.5, is: 'charcoal painted metal' },
  paintBlack: { color: '#17191c', metalness: 0.3, roughness: 0.55, is: 'black powder-coated metal' },
  paintYellow: { color: '#d89b18', metalness: 0.26, roughness: 0.42, is: 'safety yellow paint' },
  paintOrange: { color: '#dd5a1b', metalness: 0.3, roughness: 0.36, is: 'robot orange paint' },
  paintRed: { color: '#b8322a', metalness: 0.28, roughness: 0.4, is: 'red paint (tool chests, e-stops)' },
  paintBlue: { color: '#27558f', metalness: 0.3, roughness: 0.4, is: 'industrial blue paint' },
  paintGreen: { color: '#2b6e55', metalness: 0.32, roughness: 0.46, is: 'machine green paint' },
  steel: { color: '#707b88', metalness: 0.74, roughness: 0.36, is: 'galvanised or bare steel' },
  darkSteel: { color: '#3a424d', metalness: 0.6, roughness: 0.46, is: 'dark structural steel' },
  stainless: { color: '#b9c1ca', metalness: 0.85, roughness: 0.28, is: 'stainless steel (tables, sinks)' },
  aluminium: { color: '#b6c0cb', metalness: 0.82, roughness: 0.24, is: 'brushed aluminium (extrusions, rollers)' },
  chrome: { color: '#e0e6ee', metalness: 0.94, roughness: 0.14, is: 'polished chrome (shafts, handles)' },
  castIron: { color: '#2a2f37', metalness: 0.56, roughness: 0.68, is: 'cast iron (machine beds, vises)' },
  brass: { color: '#c99a3c', metalness: 0.86, roughness: 0.24, is: 'brass fittings' },
  copper: { color: '#b9693a', metalness: 0.86, roughness: 0.26, is: 'copper pipe or windings' },
  rubber: { color: '#1d2127', metalness: 0.05, roughness: 0.92, is: 'black rubber (wheels, belts, feet, hoses)' },
  plasticBlack: { color: '#22252a', metalness: 0.05, roughness: 0.6, is: 'black plastic' },
  plasticGrey: { color: '#9aa1a8', metalness: 0.05, roughness: 0.6, is: 'grey plastic' },
  plasticBlue: { color: '#2f6fb5', metalness: 0.05, roughness: 0.55, is: 'blue plastic (bins, crates)' },
  plasticRed: { color: '#c0392b', metalness: 0.05, roughness: 0.55, is: 'red plastic (bins)' },
  plasticYellow: { color: '#e0b020', metalness: 0.05, roughness: 0.55, is: 'yellow plastic (bins)' },
  wood: { color: '#a37e50', metalness: 0.04, roughness: 0.84, is: 'wood (bench tops, crates)' },
  woodLight: { color: '#d2b48a', metalness: 0.04, roughness: 0.8, is: 'light wood or butcher block' },
  cardboard: { color: '#b88f5e', metalness: 0.02, roughness: 0.92, is: 'cardboard cartons' },
  pegboard: { color: '#5a5f66', metalness: 0.2, roughness: 0.7, is: 'perforated back panel' },
  glass: { color: '#9fc0d8', metalness: 0.4, roughness: 0.08, opacity: 0.35, is: 'clear glass or polycarbonate' },
  glassDark: { color: '#1b2b38', metalness: 0.55, roughness: 0.1, opacity: 0.55, is: 'tinted safety window' },
  screen: { color: '#38bdf8', metalness: 0.1, roughness: 0.2, emissive: '#0284c7', glow: 0.9, is: 'lit display or HMI screen' },
  ledGreen: { color: '#34d399', metalness: 0.1, roughness: 0.3, emissive: '#10b981', glow: 1.3, is: 'green indicator light' },
  ledAmber: { color: '#fbbf24', metalness: 0.1, roughness: 0.3, emissive: '#f59e0b', glow: 1.3, is: 'amber indicator or work light' },
  ledRed: { color: '#f87171', metalness: 0.1, roughness: 0.3, emissive: '#dc2626', glow: 1.3, is: 'red indicator light' },
  hazard: { color: '#e0b020', metalness: 0.2, roughness: 0.5, is: 'yellow and black hazard striping' },
  concrete: { color: '#7d848c', metalness: 0.08, roughness: 0.9, is: 'concrete plinth' },
} as const satisfies Record<string, { color: string; metalness: number; roughness: number; opacity?: number; emissive?: string; glow?: number; is: string }>;
export type MaterialName = keyof typeof MATERIALS;
export const MATERIAL_NAMES = Object.keys(MATERIALS) as MaterialName[];

export const SHAPES = ['box', 'cylinder', 'cone', 'sphere', 'torus'] as const;
export type Shape = (typeof SHAPES)[number];
export const MOTIONS = ['none', 'spin_x', 'spin_y', 'spin_z', 'bob', 'pulse'] as const;
export type Motion = (typeof MOTIONS)[number];

export interface ModelPart {
  /** what the part is, in a few words: "cast-iron base bed" */
  label: string;
  shape: Shape;
  /**
   * metres. box: x, y, z. cylinder: diameter, height, diameter (axis up).
   * cone: bottom diameter, height, top diameter. sphere: x, y, z diameters.
   * torus: outer diameter, tube thickness, outer diameter (lying flat, axis up).
   */
  size: [number, number, number];
  /** centre in metres: x across the front, y up from the floor, z toward the front */
  at: [number, number, number];
  /** degrees about x, y, z */
  rot: [number, number, number];
  material: MaterialName;
  motion: Motion;
}

export interface MachineModel {
  name: string;
  /** the envelope the parts were designed for and fitted to */
  size: { w: number; d: number; h: number };
  parts: ModelPart[];
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Half-extents of the axis-aligned box that contains a part after its rotation. */
function halfExtents(p: ModelPart): [number, number, number] {
  const h: [number, number, number] = p.shape === 'torus' ? [p.size[0] / 2, p.size[1] / 2, p.size[0] / 2] : [p.size[0] / 2, p.size[1] / 2, p.size[2] / 2];
  if (p.shape === 'cone') h[0] = h[2] = Math.max(p.size[0], p.size[2]) / 2;
  if (!p.rot[0] && !p.rot[1] && !p.rot[2]) return h;
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(rad(p.rot[0])), Math.sin(rad(p.rot[0])), Math.cos(rad(p.rot[1])), Math.sin(rad(p.rot[1])), Math.cos(rad(p.rot[2])), Math.sin(rad(p.rot[2]))];
  // rotation matrix for three.js default 'XYZ' Euler order
  const m = [
    [cy * cz, -cy * sz, sy],
    [cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy],
    [sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy],
  ];
  return m.map((row) => Math.abs(row[0]) * h[0] + Math.abs(row[1]) * h[1] + Math.abs(row[2]) * h[2]) as [number, number, number];
}

export interface Box3 {
  min: [number, number, number];
  max: [number, number, number];
}
export function partBox(p: ModelPart): Box3 {
  const h = halfExtents(p);
  return { min: [p.at[0] - h[0], p.at[1] - h[1], p.at[2] - h[2]], max: [p.at[0] + h[0], p.at[1] + h[1], p.at[2] + h[2]] };
}
export function modelBox(parts: ModelPart[]): Box3 {
  const b: Box3 = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const p of parts) {
    const pb = partBox(p);
    for (let i = 0; i < 3; i++) {
      b.min[i] = Math.min(b.min[i], pb.min[i]);
      b.max[i] = Math.max(b.max[i], pb.max[i]);
    }
  }
  return b;
}

/** Make any object into a well-formed model: known shapes and materials, numeric triples, sane sizes. */
export function normaliseModel(raw: any, fallbackSize: { w: number; d: number; h: number }): MachineModel {
  const num = (v: unknown, f: number) => (typeof v === 'number' && Number.isFinite(v) ? v : f);
  const triple = (v: unknown, f: number): [number, number, number] => {
    const a = Array.isArray(v) ? v : [];
    return [num(a[0], f), num(a[1], f), num(a[2], f)];
  };
  const parts: ModelPart[] = [];
  for (const p of Array.isArray(raw?.parts) ? raw.parts.slice(0, 160) : []) {
    const shape: Shape = (SHAPES as readonly string[]).includes(p?.shape) ? p.shape : 'box';
    const size = triple(p?.size, 0.1).map((v) => Math.abs(v)) as [number, number, number];
    if (shape === 'cylinder' || shape === 'torus') size[2] = size[0];
    parts.push({
      label: String(p?.label ?? 'part').slice(0, 60),
      shape,
      size,
      at: triple(p?.at, 0),
      rot: triple(p?.rot, 0),
      material: MATERIAL_NAMES.includes(p?.material) ? p.material : 'paintGrey',
      motion: (MOTIONS as readonly string[]).includes(p?.motion) ? p.motion : 'none',
    });
  }
  const s = raw?.size ?? {};
  const side = (v: unknown, f: number) => (typeof v === 'number' && v >= 0.2 && v <= 12 ? Math.round(v * 100) / 100 : f);
  return { name: String(raw?.name ?? 'Machine').slice(0, 60), size: { w: side(s.w ?? raw?.w, fallbackSize.w), d: side(s.d ?? raw?.d, fallbackSize.d), h: side(s.h ?? raw?.h, fallbackSize.h) }, parts };
}

export const MIN_PARTS = 14;
export const MAX_PARTS = 140;
const TOUCH = 0.025;

/**
 * Code decides whether a model holds together. Messages are written for the designer:
 * each names the parts at fault and says what to change.
 */
export function checkModel(m: MachineModel): string[] {
  const errs: string[] = [];
  const { w, d, h } = m.size;
  const n = m.parts.length;
  if (n < MIN_PARTS) errs.push(`only ${n} parts: a detailed model needs at least ${MIN_PARTS}. Add the sub-assemblies a real one has (feet, frame members, handles, controls, guards, fasteners plates, cables)`);
  if (n > MAX_PARTS) errs.push(`${n} parts is over the limit of ${MAX_PARTS}`);
  if (!n) return errs;

  const thin = m.parts.filter((p) => Math.min(p.size[0], p.size[1], p.shape === 'torus' ? p.size[1] : p.size[2]) < 0.004);
  if (thin.length) errs.push(`these parts have a side under 4 mm and will not show: ${thin.slice(0, 6).map((p) => `"${p.label}"`).join(', ')}. Give every side at least 0.005 m`);

  const b = modelBox(m.parts);
  const got = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  const want = [w, h, d];
  const axis = ['width (x)', 'height (y)', 'depth (z)'];
  for (let i = 0; i < 3; i++) {
    const ratio = got[i] / want[i];
    if (ratio > 1.15) errs.push(`the parts span ${got[i].toFixed(2)} m in ${axis[i]} but the machine is ${want[i]} m: shrink or move parts so it fits`);
    else if (ratio < 0.7) errs.push(`the parts span only ${got[i].toFixed(2)} m in ${axis[i]} but the machine is ${want[i]} m: the model should fill its envelope`);
  }
  if (b.min[1] > 0.05) errs.push(`the lowest part is ${b.min[1].toFixed(2)} m above the floor: the machine must stand on y = 0`);
  if (b.min[1] < -0.05) errs.push(`parts go ${(-b.min[1]).toFixed(2)} m below the floor (y < 0): raise them`);

  // connectivity: every part must reach the floor through parts that touch
  const boxes = m.parts.map(partBox);
  const touches = (a: Box3, c: Box3) => a.min[0] <= c.max[0] + TOUCH && c.min[0] <= a.max[0] + TOUCH && a.min[1] <= c.max[1] + TOUCH && c.min[1] <= a.max[1] + TOUCH && a.min[2] <= c.max[2] + TOUCH && c.min[2] <= a.max[2] + TOUCH;
  const floor = Math.min(0, b.min[1]);
  const reached = boxes.map((x) => x.min[1] <= floor + 0.04);
  const queue = reached.map((r, i) => (r ? i : -1)).filter((i) => i >= 0);
  while (queue.length) {
    const i = queue.pop()!;
    for (let j = 0; j < n; j++) {
      if (!reached[j] && touches(boxes[i], boxes[j])) {
        reached[j] = true;
        queue.push(j);
      }
    }
  }
  const floating = m.parts.filter((_, i) => !reached[i]);
  if (floating.length) {
    errs.push(
      `${floating.length} part${floating.length > 1 ? 's float' : ' floats'} in the air, touching nothing that reaches the floor: ${floating
        .slice(0, 8)
        .map((p) => `"${p.label}" at y ${p.at[1].toFixed(2)}`)
        .join(', ')}${floating.length > 8 ? ', and more' : ''}. Move each so it sits on or against another part, or add the bracket, post or arm that holds it`,
    );
  }
  return errs;
}

/** Centre the model on the origin, stand it on the floor and scale it to its stated envelope. */
export function fitModel(m: MachineModel): MachineModel {
  if (!m.parts.length) return m;
  const b = modelBox(m.parts);
  const got = [b.max[0] - b.min[0] || 1, b.max[1] - b.min[1] || 1, b.max[2] - b.min[2] || 1];
  const k = [m.size.w / got[0], m.size.h / got[1], m.size.d / got[2]];
  const mean = Math.cbrt(k[0] * k[1] * k[2]);
  const cx = (b.min[0] + b.max[0]) / 2;
  const cz = (b.min[2] + b.max[2]) / 2;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return {
    ...m,
    parts: m.parts.map((p) => {
      const straight = !p.rot[0] && !p.rot[1] && !p.rot[2];
      const round = p.shape !== 'box';
      // boxes stretch with the envelope; round and rotated parts keep their proportions
      const s: [number, number, number] =
        straight && !round ? [p.size[0] * k[0], p.size[1] * k[1], p.size[2] * k[2]] : straight && (p.shape === 'cylinder' || p.shape === 'cone') ? [p.size[0] * Math.sqrt(k[0] * k[2]), p.size[1] * k[1], p.size[2] * Math.sqrt(k[0] * k[2])] : [p.size[0] * mean, p.size[1] * mean, p.size[2] * mean];
      return { ...p, size: s.map(r3) as [number, number, number], at: [r3((p.at[0] - cx) * k[0]), r3((p.at[1] - b.min[1]) * k[1]), r3((p.at[2] - cz) * k[2])] as [number, number, number] };
    }),
  };
}

/** One line per part, for showing a model to a model. */
export function describeModel(m: MachineModel): string {
  return m.parts.map((p, i) => `${i + 1}. ${p.label}: ${p.shape} ${p.size.map((v) => v.toFixed(2)).join(' x ')} at ${p.at.map((v) => v.toFixed(2)).join(', ')}${p.rot.some(Boolean) ? ` rot ${p.rot.join(',')}` : ''} ${p.material}${p.motion !== 'none' ? ` ${p.motion}` : ''}`).join('\n');
}

/**
 * Parts that act as a roof: big, flat, near the top of something tall enough to walk into.
 * Seen from above they hide everything that makes the machine worth looking at, so the scene
 * draws them see-through.
 */
export function roofParts(m: MachineModel): Set<number> {
  const out = new Set<number>();
  const { w, d, h } = m.size;
  if (h < 1.9) return out;
  m.parts.forEach((p, i) => {
    const b = partBox(p);
    const area = (b.max[0] - b.min[0]) * (b.max[2] - b.min[2]);
    const thick = b.max[1] - b.min[1];
    if (b.max[1] >= h * 0.8 && b.min[1] >= h * 0.45 && thick <= h * 0.3 && area >= w * d * 0.35) out.add(i);
  });
  return out;
}

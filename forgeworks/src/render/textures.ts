import * as THREE from 'three';

let cachedFloorTex: THREE.CanvasTexture | null = null;
let cachedAoTex: THREE.CanvasTexture | null = null;
let cachedBumpTex: THREE.CanvasTexture | null = null;
let cachedBeltTex: THREE.CanvasTexture | null = null;
let cachedMarkingsTex: THREE.CanvasTexture | null = null;
let cachedIsSoftwareGl: boolean | null = null;

export function detectSoftwareGl(): boolean {
  if (cachedIsSoftwareGl !== null) return cachedIsSoftwareGl;
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) {
      cachedIsSoftwareGl = true;
      return true;
    }
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    cachedIsSoftwareGl = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(
      gpu
    );
  } catch {
    cachedIsSoftwareGl = false;
  }
  return cachedIsSoftwareGl;
}

export function getFactoryFloorTextures(maxAnisotropy = 8): {
  map: THREE.CanvasTexture;
  aoMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
} {
  if (cachedFloorTex && cachedAoTex && cachedBumpTex) {
    return { map: cachedFloorTex, aoMap: cachedAoTex, bumpMap: cachedBumpTex };
  }

  const size = 256;
  // 1. Realistic troweled architectural industrial concrete (2x2m poured slab bay)
  const c1 = document.createElement('canvas');
  c1.width = size;
  c1.height = size;
  const ctx = c1.getContext('2d')!;
  ctx.fillStyle = '#5e646d';
  ctx.fillRect(0, 0, size, size);

  // Subtle trowel mottling patches
  for (let i = 0; i < 18; i++) {
    const cx = ((i * 61 + 29) % size);
    const cy = ((i * 97 + 41) % size);
    const r = 24 + (i % 4) * 14;
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, r);
    const shade = i % 2 === 0 ? 'rgba(255,255,255,0.032)' : 'rgba(20,24,30,0.04)';
    g.addColorStop(0, shade);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  // Fine mineral aggregate speckles
  for (let i = 0; i < 1500; i++) {
    const x = (i * 97 + (i % 7) * 13) % size;
    const y = (i * 151 + (i % 5) * 19) % size;
    ctx.fillStyle =
      i % 2 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(15,18,22,0.055)';
    ctx.fillRect(x, y, 2, 2);
  }

  // Subtle 1-meter interior tile score lines
  ctx.strokeStyle = 'rgba(30, 36, 44, 0.16)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(size / 2, 0);
  ctx.lineTo(size / 2, size);
  ctx.moveTo(0, size / 2);
  ctx.lineTo(size, size / 2);
  ctx.stroke();

  // Outer 2-meter concrete expansion joint seam
  ctx.strokeStyle = 'rgba(34, 40, 48, 0.42)';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(1.25, 1.25, size - 2.5, size - 2.5);

  const map = new THREE.CanvasTexture(c1);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(32, 32);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = maxAnisotropy;

  // 2. Subtle ambient occlusion vignette
  const c2 = document.createElement('canvas');
  c2.width = size;
  c2.height = size;
  const aoCtx = c2.getContext('2d')!;
  const grad = aoCtx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.2,
    size / 2,
    size / 2,
    size * 0.74
  );
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(1, '#cfd6df');
  aoCtx.fillStyle = grad;
  aoCtx.fillRect(0, 0, size, size);

  const aoMap = new THREE.CanvasTexture(c2);
  aoMap.wrapS = THREE.RepeatWrapping;
  aoMap.wrapT = THREE.RepeatWrapping;
  aoMap.repeat.set(32, 32);
  aoMap.anisotropy = maxAnisotropy;

  // 3. Soft linear concrete micro-bump map
  const c3 = document.createElement('canvas');
  c3.width = size;
  c3.height = size;
  const bCtx = c3.getContext('2d')!;
  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, size, size);
  for (let i = 0; i < 800; i++) {
    const x = (i * 67) % size;
    const y = (i * 113) % size;
    bCtx.fillStyle = i % 2 === 0 ? '#8c8c8c' : '#747474';
    bCtx.fillRect(x, y, 2, 2);
  }
  bCtx.strokeStyle = '#606060';
  bCtx.lineWidth = 2;
  bCtx.strokeRect(1, 1, size - 2, size - 2);

  const bumpMap = new THREE.CanvasTexture(c3);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(32, 32);
  bumpMap.anisotropy = maxAnisotropy;

  cachedFloorTex = map;
  cachedAoTex = aoMap;
  cachedBumpTex = bumpMap;
  return { map, aoMap, bumpMap };
}

/**
 * Painted OSHA safety walkways, production zone bays, and stenciled stage labels
 * mapped 1:1 over the 64x64 factory floor so anyone immediately understands the left-to-right flow.
 */
export function getFloorMarkingsTexture(
  maxAnisotropy = 8
): THREE.CanvasTexture {
  if (cachedMarkingsTex) return cachedMarkingsTex;

  const size = 1024;
  const scale = size / 64; // 16px per meter
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);

  const rect = (
    x: number,
    z: number,
    w: number,
    h: number,
    stroke: string,
    fill: string,
    label: string,
    labelPos: 'top' | 'bottom' = 'bottom'
  ) => {
    const px = x * scale;
    const pz = z * scale;
    const pw = w * scale;
    const ph = h * scale;

    ctx.fillStyle = fill;
    ctx.fillRect(px, pz, pw, ph);

    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, pz + 1, pw - 2, ph - 2);

    ctx.fillStyle = stroke;
    ctx.font = '700 12px "Bahnschrift", "Arial Narrow", sans-serif';
    const textY = labelPos === 'top' ? pz + 15 : pz + ph - 7;
    ctx.fillText(label, px + 7, textY);
  };

  // Outer OSHA yellow safety corridor border around the active industrial bay
  ctx.strokeStyle = 'rgba(234, 179, 8, 0.65)';
  ctx.lineWidth = 4;
  ctx.strokeRect(13 * scale, 14.5 * scale, 35 * scale, 32 * scale);

  // Pedestrian safety walkway strip along south corridor (z = 45.1..46.2)
  ctx.fillStyle = 'rgba(34, 197, 94, 0.14)';
  ctx.fillRect(13.5 * scale, 45.1 * scale, 34 * scale, 1.15 * scale);
  ctx.strokeStyle = 'rgba(234, 179, 8, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(13.5 * scale, 45.1 * scale, 34 * scale, 1.15 * scale);

  // 5 Painted Factory Floor Production Zones (left-to-right story)
  rect(
    14.2,
    14.8,
    9.6,
    10.2,
    'rgba(245, 158, 11, 0.78)',
    'rgba(245, 158, 11, 0.05)',
    '01 · POWER PLANT',
    'top'
  );

  rect(
    17.2,
    25.4,
    5.4,
    17.4,
    'rgba(203, 213, 225, 0.68)',
    'rgba(148, 163, 184, 0.04)',
    '02 · MINING',
    'bottom'
  );

  rect(
    23.0,
    25.4,
    5.4,
    17.4,
    'rgba(249, 115, 22, 0.78)',
    'rgba(234, 88, 12, 0.05)',
    '03 · SMELTING',
    'bottom'
  );

  rect(
    28.8,
    25.4,
    8.5,
    17.4,
    'rgba(56, 189, 248, 0.72)',
    'rgba(56, 189, 248, 0.04)',
    '04 · CNC & CIRCUITS',
    'bottom'
  );

  rect(
    37.8,
    25.4,
    9.2,
    17.4,
    'rgba(16, 185, 129, 0.78)',
    'rgba(16, 185, 129, 0.05)',
    '05 · QC & SHIPPING',
    'bottom'
  );

  // Subtle painted directional flow arrows along the main corridor
  ctx.fillStyle = 'rgba(241, 245, 249, 0.25)';
  const drawArrow = (x: number, z: number) => {
    const px = x * scale;
    const pz = z * scale;
    ctx.beginPath();
    ctx.moveTo(px, pz - 6);
    ctx.lineTo(px + 18, pz - 6);
    ctx.lineTo(px + 18, pz - 12);
    ctx.lineTo(px + 30, pz);
    ctx.lineTo(px + 18, pz + 12);
    ctx.lineTo(px + 18, pz + 6);
    ctx.lineTo(px, pz + 6);
    ctx.closePath();
    ctx.fill();
  };
  drawArrow(22.0, 30.8);
  drawArrow(28.0, 30.8);
  drawArrow(36.9, 30.8);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  cachedMarkingsTex = tex;
  return tex;
}

export function getConveyorBeltTexture(maxAnisotropy = 8): THREE.CanvasTexture {
  if (cachedBeltTex) return cachedBeltTex;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Matte vulcanized industrial rubber tread with subtle rib grain
  ctx.fillStyle = '#232830';
  ctx.fillRect(0, 0, size, size);

  for (let y = 0; y < size; y += 8) {
    ctx.fillStyle = y % 16 === 0 ? '#2b313b' : '#1d2229';
    ctx.fillRect(8, y, size - 16, 4);
  }

  // Exposed galvanized steel edge rollers peeking beside belt margins
  ctx.fillStyle = '#6c7785';
  ctx.fillRect(0, 0, 7, size);
  ctx.fillRect(size - 7, 0, 7, size);
  ctx.fillStyle = '#3a424d';
  for (let y = 0; y < size; y += 16) {
    ctx.fillRect(0, y, 7, 3);
    ctx.fillRect(size - 7, y, 7, 3);
  }

  // Heavy steel transverse grip cleats
  ctx.fillStyle = '#3e4754';
  ctx.fillRect(10, 10, size - 20, 8);
  ctx.fillRect(10, 74, size - 20, 8);
  ctx.fillStyle = '#535f70';
  ctx.fillRect(10, 10, size - 20, 2);
  ctx.fillRect(10, 74, size - 20, 2);

  // Subtle painted industrial directional guide chevron
  ctx.strokeStyle = 'rgba(217, 155, 30, 0.58)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(40, 62);
  ctx.lineTo(64, 34);
  ctx.lineTo(88, 62);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  cachedBeltTex = tex;
  return tex;
}

let cachedPanelBump: THREE.CanvasTexture | null = null;
let cachedVentTex: THREE.CanvasTexture | null = null;
let cachedHazardTex: THREE.CanvasTexture | null = null;

/**
 * Procedural sheet-metal panel seams, corner rivets, and brushed steel grain bump map.
 * Applied to industrial housings so machines catch realistic metallic edge highlights.
 */
export function getIndustrialPanelBumpTexture(
  maxAnisotropy = 8
): THREE.CanvasTexture {
  if (cachedPanelBump) return cachedPanelBump;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);

  // Subtle horizontal brushed-metal micro-grain
  for (let y = 0; y < size; y += 2) {
    const shade = 122 + Math.round((Math.sin(y * 1.9) * 0.5 + 0.5) * 14);
    ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
    ctx.fillRect(0, y, size, 1);
  }

  // Recessed sheet-metal perimeter seam
  ctx.strokeStyle = '#383838';
  ctx.lineWidth = 3;
  ctx.strokeRect(4, 4, size - 8, size - 8);
  ctx.strokeStyle = '#a8a8a8';
  ctx.lineWidth = 1;
  ctx.strokeRect(6, 6, size - 12, size - 12);

  // Mid inspection hatch seam
  ctx.fillStyle = '#404040';
  ctx.fillRect(4, size / 2 - 1, size - 8, 2);

  // Corner hex rivets
  const rivets = [
    [12, 12],
    [size - 12, 12],
    [12, size - 12],
    [size - 12, size - 12],
    [12, size / 2 + 8],
    [size - 12, size / 2 + 8],
  ];
  for (const [rx, ry] of rivets) {
    ctx.fillStyle = '#c8c8c8';
    ctx.beginPath();
    ctx.arc(rx, ry, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  cachedPanelBump = tex;
  return tex;
}

/** Stamped steel cooling radiator louver grille for turbine gensets, drills, and CNC cabinets */
export function getVentLouverTexture(maxAnisotropy = 8): THREE.CanvasTexture {
  if (cachedVentTex) return cachedVentTex;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#363d47';
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = '#586270';
  ctx.lineWidth = 4;
  ctx.strokeRect(3, 3, size - 6, size - 6);

  // Horizontal stamped louver slats
  for (let y = 14; y < size - 12; y += 11) {
    ctx.fillStyle = '#14181e';
    ctx.fillRect(14, y, size - 28, 5);
    ctx.fillStyle = '#626d7c';
    ctx.fillRect(14, y + 5, size - 28, 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  cachedVentTex = tex;
  return tex;
}

/** Crisp OSHA black & industrial-yellow diagonal safety stripes */
export function getHazardStripeTexture(maxAnisotropy = 8): THREE.CanvasTexture {
  if (cachedHazardTex) return cachedHazardTex;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#d99e1a';
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = '#1e2228';
  const stripeW = 22;
  for (let x = -size; x < size * 2; x += stripeW * 2) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + stripeW, 0);
    ctx.lineTo(x + stripeW - size, size);
    ctx.lineTo(x - size, size);
    ctx.closePath();
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  cachedHazardTex = tex;
  return tex;
}


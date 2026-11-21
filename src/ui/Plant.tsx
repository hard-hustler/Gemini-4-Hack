// What a plant-scale floor needs that a workshop does not: conveyors carrying product between
// steps, department zones marked on the floor, and machines merged into a few meshes each so a
// hundred of them still render smoothly.

import { Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Routes } from '../engines/route';
import { buildParts, TONE_HEX, type MachineRecipe } from '../machines';
import { MATERIALS, roofParts, type MachineModel } from '../model3d';
import { footprint, type FactorySpec } from '../spec';

// ---------- merged machines ----------
interface Solid {
  shape: 'box' | 'cyl' | 'cone' | 'sphere' | 'torus';
  size: [number, number, number];
  at: [number, number, number];
  /** radians */
  rot?: [number, number, number];
  key: string;
}

function solidGeometry(s: Solid): THREE.BufferGeometry {
  const [a, b, c] = s.size;
  let g: THREE.BufferGeometry;
  if (s.shape === 'box') g = new THREE.BoxGeometry(a, b, c);
  else if (s.shape === 'cyl') g = new THREE.CylinderGeometry(a / 2, a / 2, b, 14);
  else if (s.shape === 'cone') g = new THREE.CylinderGeometry(c / 2, a / 2, b, 14);
  else if (s.shape === 'sphere') g = new THREE.SphereGeometry(0.5, 14, 10).scale(a, b, c);
  else {
    const tube = Math.min(b, a / 2) / 2;
    g = new THREE.TorusGeometry(Math.max(0.001, a / 2 - tube), tube, 8, 20).rotateX(Math.PI / 2);
  }
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...s.at), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(s.rot ?? [0, 0, 0]))), new THREE.Vector3(1, 1, 1));
  return g.applyMatrix4(m);
}

const mergedCache = new Map<string, { key: string; geometry: THREE.BufferGeometry }[]>();
function merged(cacheKey: string, solids: () => Solid[]) {
  let hit = mergedCache.get(cacheKey);
  if (!hit) {
    const groups = new Map<string, THREE.BufferGeometry[]>();
    for (const s of solids()) {
      const list = groups.get(s.key) ?? [];
      list.push(solidGeometry(s));
      groups.set(s.key, list);
    }
    hit = [...groups].map(([key, list]) => {
      const geometry = mergeGeometries(list, false) ?? list[0];
      list.forEach((g) => g !== geometry && g.dispose());
      return { key, geometry };
    });
    if (mergedCache.size > 200) mergedCache.delete(mergedCache.keys().next().value as string);
    mergedCache.set(cacheKey, hit);
  }
  return hit;
}

const liteMaterials = new Map<string, THREE.MeshStandardMaterial>();
function liteMaterial(key: string): THREE.MeshStandardMaterial {
  let m = liteMaterials.get(key);
  if (!m) {
    const [kind, name, roof] = key.split(':');
    if (kind === 'tone') {
      const [tone, opacity, glow] = name.split('|');
      const color = TONE_HEX[tone as keyof typeof TONE_HEX] ?? '#888';
      const see = opacity !== '' || tone === 'glass';
      m = new THREE.MeshStandardMaterial({ color, roughness: tone === 'glass' ? 0.25 : 0.85, transparent: see, opacity: opacity !== '' ? Number(opacity) : tone === 'glass' ? 0.7 : 1, emissive: glow ? color : '#000', emissiveIntensity: glow ? 0.5 : 0 });
    } else {
      const def = MATERIALS[name as keyof typeof MATERIALS] as { color: string; metalness: number; roughness: number; opacity?: number; emissive?: string; glow?: number };
      // a roof is drawn as a ghost so the machine under it shows
      m = new THREE.MeshStandardMaterial({ color: def.color, metalness: def.metalness, roughness: def.roughness, transparent: !!roof || def.opacity !== undefined, opacity: roof ? 0.14 : (def.opacity ?? 1), depthWrite: !roof, emissive: def.emissive ?? '#000', emissiveIntensity: def.glow ?? 0 });
    }
    liteMaterials.set(key, m);
  }
  return m;
}

const rad = (d: number) => (d * Math.PI) / 180;

/** A machine as a handful of meshes: every part of one material merged into one geometry. No moving parts. */
export function LiteMachine({ recipe, model }: { recipe?: MachineRecipe; model?: MachineModel }) {
  const groups = useMemo(() => {
    if (model) {
      const roofs = roofParts(model);
      return merged(`model|${model.name}|${model.parts.length}|${JSON.stringify(model.size)}`, () =>
        model.parts.map((p, i) => ({ shape: p.shape === 'cylinder' ? 'cyl' : p.shape, size: p.size, at: p.at, rot: [rad(p.rot[0]), rad(p.rot[1]), rad(p.rot[2])] as [number, number, number], key: `mat:${p.material}${roofs.has(i) ? ':roof' : ''}` })),
      );
    }
    if (!recipe) return [];
    return merged(`recipe|${JSON.stringify(recipe)}`, () => buildParts(recipe).map((p) => ({ shape: p.shape, size: p.size, at: p.at, rot: p.rot, key: `tone:${p.tone}|${p.opacity ?? ''}|${p.glow ? 1 : ''}` })));
  }, [recipe, model]);
  return (
    <>
      {groups.map((g) => {
        const material = liteMaterial(g.key);
        return <mesh key={g.key} geometry={g.geometry} material={material} castShadow={!material.transparent} receiveShadow />;
      })}
    </>
  );
}

// ---------- zones ----------
const ZONE_TINTS = ['#e2873a', '#5b8fd6', '#4d9d74', '#b98a5a', '#9a6fc0', '#d1543f', '#3aa3a0', '#c9a227'];

export function zonesOf(spec: FactorySpec) {
  const map = new Map<string, { minX: number; maxX: number; minY: number; maxY: number; count: number }>();
  for (const s of spec.stations) {
    if (!s.zone) continue;
    const f = footprint(s);
    const z = map.get(s.zone) ?? { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, count: 0 };
    z.minX = Math.min(z.minX, f.x);
    z.maxX = Math.max(z.maxX, f.x + f.w);
    z.minY = Math.min(z.minY, f.y);
    z.maxY = Math.max(z.maxY, f.y + f.d);
    z.count++;
    map.set(s.zone, z);
  }
  return [...map].map(([name, z], i) => ({ name, ...z, tint: ZONE_TINTS[i % ZONE_TINTS.length] }));
}

/** Department areas painted on the floor, each with its name. */
export function Zones({ spec, labels }: { spec: FactorySpec; labels: boolean }) {
  const zones = useMemo(() => zonesOf(spec), [spec]);
  const { width, depth } = spec.floor;
  const pad = 1.5;
  return (
    <>
      {zones.map((z, i) => {
        const w = z.maxX - z.minX + pad * 2;
        const d = z.maxY - z.minY + pad * 2;
        const cx = (z.minX + z.maxX) / 2 - width / 2;
        const cz = (z.minY + z.maxY) / 2 - depth / 2;
        // sized to the floor, then shrunk so the name fits along its own department
        const base = Math.max(0.6, Math.min(4, Math.max(width, depth) / 40));
        const size = Math.max(0.4, Math.min(base, w / (z.name.length * 0.72)));
        return (
          <group key={z.name}>
            <mesh position={[cx, 0.008 + i * 0.001, cz]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[w, d]} />
              <meshBasicMaterial color={z.tint} transparent opacity={0.1} depthWrite={false} />
            </mesh>
            {labels && (
              <Text position={[cx - w / 2, 0.03, cz - d / 2 - 0.4]} rotation={[-Math.PI / 2, 0, 0]} fontSize={size} color={z.tint} anchorX="left" anchorY="bottom" fillOpacity={0.85} letterSpacing={0.04}>
                {z.name.toUpperCase()}
              </Text>
            )}
          </group>
        );
      })}
    </>
  );
}

// ---------- conveyors ----------
/**
 * A belt is sized to the machines it serves: about a quarter of a typical machine's short side,
 * between a 0.3 m parts conveyor and the 0.8 m line of a plant. Everything else follows from it.
 */
function beltSize(spec: FactorySpec) {
  const sides = spec.stations.map((s) => Math.min(s.w, s.d)).sort((a, b) => a - b);
  const typical = sides[sides.length >> 1] ?? 2;
  const w = Math.max(0.3, Math.min(0.8, typical * 0.26));
  const k = w / 0.8;
  return { w, k, bedY: Math.max(0.45, 0.72 * Math.sqrt(k)) };
}

/** Every routed path as a conveyor: bed, side rails, legs, and product riding along it. */
export function Conveyors({ spec, routes, animate }: { spec: FactorySpec; routes: Routes; animate: boolean }) {
  const { width, depth } = spec.floor;
  const belt = useMemo(() => beltSize(spec), [spec]);
  const BELT_W = belt.w;
  const BED_Y = belt.bedY;
  const K = belt.k;
  const data = useMemo(() => {
    // Paths share trunks, so the belt is drawn from the set of unit steps any path takes: each
    // stretch once, with collinear steps joined into one long run.
    const cell = spec.floor.cellSize;
    const key = (v: number) => Math.round(v * 100);
    const along = new Map<number, Set<number>>(); // z -> x of each unit step running east-west
    const across = new Map<number, Set<number>>(); // x -> z of each unit step running north-south
    const add = (m: Map<number, Set<number>>, line: number, at: number) => {
      const set = m.get(line) ?? new Set<number>();
      set.add(at);
      m.set(line, set);
    };
    const paths: { pts: THREE.Vector3[]; cum: number[]; total: number }[] = [];
    for (const p of routes.forklift) {
      const pts = p.points.map((q) => new THREE.Vector3(q.x - width / 2, BED_Y, q.y - depth / 2));
      const cum = [0];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const len = a.distanceTo(b);
        cum.push(cum[i - 1] + len);
        const n = Math.round(len / cell);
        const alongX = Math.abs(b.x - a.x) > Math.abs(b.z - a.z);
        for (let k = 0; k < n; k++) {
          if (alongX) add(along, key(a.z), key(Math.min(a.x, b.x) + k * cell));
          else add(across, key(a.x), key(Math.min(a.z, b.z) + k * cell));
        }
      }
      if (cum[cum.length - 1] > 0.5) paths.push({ pts, cum, total: cum[cum.length - 1] });
    }
    const segs: { x: number; z: number; len: number; alongX: boolean }[] = [];
    const runs = (m: Map<number, Set<number>>, alongX: boolean) => {
      const step = key(cell);
      for (const [line, set] of m) {
        const at = [...set].sort((x, y) => x - y);
        let start = at[0];
        for (let i = 1; i <= at.length; i++) {
          if (i < at.length && at[i] - at[i - 1] <= step + 1) continue;
          const from = start / 100;
          const to = at[i - 1] / 100 + cell;
          segs.push(alongX ? { x: (from + to) / 2, z: line / 100, len: to - from, alongX } : { x: line / 100, z: (from + to) / 2, len: to - from, alongX });
          start = at[i];
        }
      }
    };
    runs(along, true);
    runs(across, false);
    const legs: [number, number][] = [];
    for (const s of segs) {
      const n = Math.max(1, Math.round(s.len / 3));
      for (let k = 0; k <= n; k++) {
        const t = (k / n - 0.5) * s.len;
        legs.push(s.alongX ? [s.x + t, s.z] : [s.x, s.z + t]);
      }
    }
    // a few packages, spaced well apart: enough to show the flow without burying the belt
    const items: { path: number; offset: number }[] = [];
    const totalLen = paths.reduce((t, p) => t + p.total, 0);
    const spacing = Math.max(14, totalLen / 70);
    paths.forEach((p, i) => {
      for (let o = (i * 5.3) % spacing; o < p.total; o += spacing) items.push({ path: i, offset: o });
    });
    return { segs, paths, legs, items };
  }, [routes, width, depth, spec.floor.cellSize, BED_Y]);

  const beds = useRef<THREE.InstancedMesh>(null);
  const belts = useRef<THREE.InstancedMesh>(null);
  const rails = useRef<THREE.InstancedMesh>(null);
  const legs = useRef<THREE.InstancedMesh>(null);
  const items = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useLayoutEffect(() => {
    const place = (mesh: THREE.InstancedMesh | null, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
      if (!mesh) return;
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    };
    data.segs.forEach((s, i) => {
      // each segment overruns by half a belt width so corners close up
      const L = s.len + BELT_W;
      place(beds.current, i, s.x, BED_Y - 0.08 * K, s.z, s.alongX ? L : BELT_W, 0.14 * K, s.alongX ? BELT_W : L);
      place(belts.current, i, s.x, BED_Y, s.z, s.alongX ? L : BELT_W * 0.78, 0.03 * K, s.alongX ? BELT_W * 0.78 : L);
      for (const side of [-1, 1]) {
        const off = (side * BELT_W) / 2;
        place(rails.current, i * 2 + (side > 0 ? 1 : 0), s.x + (s.alongX ? 0 : off), BED_Y + 0.06 * K, s.z + (s.alongX ? off : 0), s.alongX ? s.len : 0.05 * K, 0.12 * K, s.alongX ? 0.05 * K : s.len);
      }
    });
    data.legs.forEach(([x, z], i) => place(legs.current, i, x, (BED_Y - 0.15 * K) / 2, z, 0.1 * K, BED_Y - 0.15 * K, BELT_W * 0.7));
    for (const m of [beds, belts, rails, legs]) if (m.current) m.current.instanceMatrix.needsUpdate = true;
  }, [data, dummy, BELT_W, BED_Y, K]);

  useFrame(({ clock }) => {
    const mesh = items.current;
    if (!mesh) return;
    const t = animate ? clock.elapsedTime * 1.4 : 0;
    data.items.forEach((it, i) => {
      const p = data.paths[it.path];
      const dist = (it.offset + t) % p.total;
      let k = 1;
      while (k < p.cum.length - 1 && p.cum[k] < dist) k++;
      const seg = p.cum[k] - p.cum[k - 1];
      dummy.position.lerpVectors(p.pts[k - 1], p.pts[k], seg > 0 ? (dist - p.cum[k - 1]) / seg : 0);
      dummy.position.y = BED_Y + 0.2 * K;
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(K, K, K);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  if (!data.segs.length) return null;
  return (
    <>
      <instancedMesh ref={beds} args={[undefined, undefined, data.segs.length]} castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#8d959e" metalness={0.6} roughness={0.4} />
      </instancedMesh>
      <instancedMesh ref={belts} args={[undefined, undefined, data.segs.length]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#23262b" roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={rails} args={[undefined, undefined, data.segs.length * 2]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#e2873a" metalness={0.3} roughness={0.5} />
      </instancedMesh>
      <instancedMesh ref={legs} args={[undefined, undefined, data.legs.length]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#3a424d" metalness={0.5} roughness={0.5} />
      </instancedMesh>
      <instancedMesh ref={items} args={[undefined, undefined, Math.max(1, data.items.length)]} castShadow>
        <boxGeometry args={[0.55, 0.36, 0.55]} />
        <meshStandardMaterial color="#d2b48a" roughness={0.8} />
      </instancedMesh>
    </>
  );
}

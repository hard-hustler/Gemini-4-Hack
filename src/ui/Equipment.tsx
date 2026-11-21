// Procedural low-poly equipment. SEAM: when a station carries a modelUrl (GLB from the
// listing -> 3D converter) that model is drawn instead, scaled to the station footprint.

import { useGLTF } from '@react-three/drei';
import { Component, Suspense, useMemo, type ReactNode } from 'react';
import * as THREE from 'three';

export const INK = '#2b2d2e';
export const BONE = '#f6f1e7';
export const ORANGE = '#e2873a';
const STEEL = '#c3c5c6';
const WOOD = '#dcb98f';

const ACCENTS: Record<string, string> = {
  storage: '#e2873a',
  kitting: '#e9b949',
  prep: '#4d9d74',
  assembly: '#e2873a',
  weld: '#d1543f',
  paint: '#5b8fd6',
  test: '#d1543f',
  inspect: '#4d9d74',
  label: '#e9b949',
  pack: '#b98a5a',
  conveyor: '#5b8fd6',
};
export const accentFor = (type: string) => ACCENTS[type] ?? '#8a8478';

type Shape = 'bench' | 'rack' | 'machine' | 'table' | 'conveyor';
const DEFAULT_SHAPE: Record<string, Shape> = { storage: 'rack', prep: 'table', assembly: 'bench', test: 'machine', pack: 'table', kitting: 'bench', inspect: 'bench', conveyor: 'conveyor' };

function Part({ size, at, color, round = false }: { size: [number, number, number]; at: [number, number, number]; color: string; round?: boolean }) {
  return (
    <mesh position={at} castShadow receiveShadow>
      {round ? <cylinderGeometry args={[size[0] / 2, size[0] / 2, size[1], 20]} /> : <boxGeometry args={size} />}
      <meshStandardMaterial color={color} roughness={0.85} metalness={0} />
    </mesh>
  );
}

function Legs({ w, d, h, color = INK }: { w: number; d: number; h: number; color?: string }) {
  const t = 0.07;
  const x = w / 2 - t;
  const z = d / 2 - t;
  return (
    <>
      {[
        [x, z],
        [-x, z],
        [x, -z],
        [-x, -z],
      ].map(([px, pz], i) => (
        <Part key={i} size={[t, h, t]} at={[px, h / 2, pz]} color={color} />
      ))}
    </>
  );
}

function Procedural({ shape, w, d, h, accent }: { shape: Shape; w: number; d: number; h: number; accent: string }) {
  switch (shape) {
    case 'rack': {
      const levels = Math.max(2, Math.round(h / 0.8));
      return (
        <>
          <Legs w={w} d={d} h={h} color={ORANGE} />
          {Array.from({ length: levels }, (_, i) => {
            const y = 0.15 + (i * (h - 0.25)) / levels;
            return (
              <group key={i}>
                <Part size={[w, 0.06, d]} at={[0, y, 0]} color={STEEL} />
                {i < levels - 0 &&
                  [-0.3, 0.05, 0.34].map((f, k) => (
                    <Part key={k} size={[w * 0.24, Math.min(0.42, (h - 0.25) / levels - 0.14), d * 0.7]} at={[f * w, y + 0.03 + Math.min(0.42, (h - 0.25) / levels - 0.14) / 2, 0]} color={k === 1 ? BONE : WOOD} />
                  ))}
              </group>
            );
          })}
        </>
      );
    }
    case 'machine':
      return (
        <>
          <Part size={[w, 0.12, d]} at={[0, 0.06, 0]} color={INK} />
          <Part size={[w * 0.96, h * 0.72, d * 0.92]} at={[0, 0.12 + (h * 0.72) / 2, 0]} color={BONE} />
          <Part size={[w * 0.96, 0.1, d * 0.92]} at={[0, 0.12 + h * 0.72 + 0.05, 0]} color={accent} />
          <Part size={[w * 0.42, h * 0.3, 0.04]} at={[-w * 0.18, 0.12 + h * 0.44, d * 0.46 + 0.02]} color={INK} />
          <Part size={[0.14, 0.14, 0.05]} at={[w * 0.3, 0.12 + h * 0.5, d * 0.46 + 0.02]} color={accent} />
          <Part size={[0.12, h * 0.25, 0.12]} at={[w * 0.36, 0.12 + h * 0.72 + 0.1 + (h * 0.25) / 2, -d * 0.25]} color={INK} round />
        </>
      );
    case 'conveyor':
      return (
        <>
          <Legs w={w} d={d} h={h * 0.8} />
          <Part size={[w, 0.1, d]} at={[0, h * 0.8, 0]} color={STEEL} />
          <Part size={[w, 0.03, d * 0.78]} at={[0, h * 0.8 + 0.065, 0]} color={INK} />
          <Part size={[w, 0.12, 0.05]} at={[0, h * 0.8 + 0.06, d / 2]} color={accent} />
          <Part size={[w, 0.12, 0.05]} at={[0, h * 0.8 + 0.06, -d / 2]} color={accent} />
        </>
      );
    case 'table':
      return (
        <>
          <Legs w={w} d={d} h={h} />
          <Part size={[w, 0.08, d]} at={[0, h, 0]} color={BONE} />
          <Part size={[w * 0.92, 0.05, d * 0.86]} at={[0, h * 0.35, 0]} color={STEEL} />
          <Part size={[w * 0.26, 0.3, d * 0.5]} at={[-w * 0.26, h + 0.19, 0]} color={WOOD} />
          <Part size={[w * 0.18, 0.2, d * 0.36]} at={[w * 0.08, h + 0.14, d * 0.1]} color={accent} />
        </>
      );
    default:
      return (
        <>
          <Legs w={w} d={d} h={h} />
          <Part size={[w, 0.08, d]} at={[0, h, 0]} color={WOOD} />
          <Part size={[w, 0.55, 0.05]} at={[0, h + 0.3, -d / 2 + 0.03]} color={accent} />
          <Part size={[w * 0.9, 0.05, d * 0.3]} at={[0, h + 0.5, -d / 2 + 0.18]} color={BONE} />
          <Part size={[w * 0.2, 0.16, d * 0.3]} at={[w * 0.22, h + 0.12, d * 0.1]} color={INK} />
          <Part size={[0.34, 0.5, 0.34]} at={[-w * 0.1, 0.25, d / 2 + 0.3]} color={INK} round />
        </>
      );
  }
}

function Glb({ url, w, d, h }: { url: string; w: number; d: number; h: number }) {
  const { scene } = useGLTF(url);
  const fitted = useMemo(() => {
    const obj = scene.clone(true);
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const k = Math.min(w / (size.x || 1), d / (size.z || 1), (h * 1.4) / (size.y || 1));
    const c = box.getCenter(new THREE.Vector3());
    obj.position.set(-c.x * k, -box.min.y * k, -c.z * k);
    obj.scale.setScalar(k);
    obj.traverse((o) => {
      o.castShadow = true;
    });
    return obj;
  }, [scene, w, d, h]);
  return <primitive object={fitted} />;
}

class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Draws one piece of equipment standing on y = 0, centred on the origin, inside w x d x h metres. */
export function Equipment({ type, shape, w, d, h, modelUrl }: { type: string; shape?: Shape; w: number; d: number; h: number; modelUrl?: string }) {
  const procedural = <Procedural shape={shape ?? DEFAULT_SHAPE[type] ?? 'machine'} w={w} d={d} h={h} accent={accentFor(type)} />;
  if (!modelUrl) return procedural;
  return (
    <Fallback fallback={procedural}>
      <Suspense fallback={procedural}>
        <Glb url={modelUrl} w={w} d={d} h={h} />
      </Suspense>
    </Fallback>
  );
}

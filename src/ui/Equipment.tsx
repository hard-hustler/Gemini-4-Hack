// Draws one piece of equipment from its recipe (src/machines.ts).
// SEAM: when a station carries a modelUrl (GLB), that model is drawn instead, scaled to the
// footprint and recoloured to nothing: it keeps its own materials.

import { Edges, useGLTF } from '@react-three/drei';
import { Component, Suspense, useMemo, type ReactNode } from 'react';
import * as THREE from 'three';
import { buildParts, defaultRecipe, TONE_HEX, type MachineRecipe, type Part } from '../machines';
import type { MachineModel } from '../model3d';
import { ModelMesh } from './ModelMesh';
import { LiteMachine } from './Plant';

/** Edge lines keep same-coloured parts apart: an all-black cart still reads as a cart. */
const EDGE: Record<string, string> = { ink: '#5d6266', bone: '#cfc6b4', steel: '#9a9d9f', wood: '#b8946a', orange: '#b9631c', red: '#a43b2a', green: '#35775a', blue: '#40699f', yellow: '#b98f2b', glass: '#7d99ad' };

export const INK = TONE_HEX.ink;
export const BONE = TONE_HEX.bone;
export const ORANGE = TONE_HEX.orange;

function PartMesh({ part }: { part: Part }) {
  const [a, b, c] = part.size;
  const color = TONE_HEX[part.tone];
  const see = part.opacity !== undefined || part.tone === 'glass';
  return (
    <mesh position={part.at} rotation={part.rot} castShadow={!see} receiveShadow>
      {part.shape === 'box' ? <boxGeometry args={[a, b, c]} /> : part.shape === 'cyl' ? <cylinderGeometry args={[a / 2, a / 2, b, 20]} /> : <cylinderGeometry args={[a / 2, c / 2, b, 20]} />}
      <meshStandardMaterial
        color={color}
        roughness={part.tone === 'glass' ? 0.25 : 0.85}
        metalness={0}
        transparent={see}
        opacity={part.opacity ?? (part.tone === 'glass' ? 0.7 : 1)}
        emissive={part.glow ? color : '#000000'}
        emissiveIntensity={part.glow ? 0.5 : 0}
      />
      {part.shape === 'box' && !see && <Edges threshold={15} color={EDGE[part.tone]} />}
    </mesh>
  );
}

export function Machine({ recipe }: { recipe: MachineRecipe }) {
  const parts = useMemo(() => buildParts(recipe), [recipe]);
  return (
    <>
      {parts.map((p, i) => (
        <PartMesh key={i} part={p} />
      ))}
    </>
  );
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

/** One piece of equipment standing on y = 0, centred on the origin. w, d, h are the footprint in metres. */
export function Equipment({
  type,
  shape,
  recipe,
  model,
  w,
  d,
  h,
  modelUrl,
  animate = true,
  lite = false,
}: {
  type: string;
  shape?: string;
  recipe?: MachineRecipe;
  /** a free-form model designed by an agent; drawn in preference to the recipe */
  model?: MachineModel;
  w: number;
  d: number;
  h: number;
  modelUrl?: string;
  animate?: boolean;
  /** plant-scale drawing: parts merged per material, no moving parts, no edge lines */
  lite?: boolean;
}) {
  const built = useMemo(() => recipe ?? defaultRecipe(type, { w, d, h }, shape), [recipe, type, shape, w, d, h]);
  const drawn = lite ? <LiteMachine recipe={model ? undefined : built} model={model} /> : model ? <ModelMesh model={model} animate={animate} /> : <Machine recipe={built} />;
  if (!modelUrl) return drawn;
  return (
    <Fallback fallback={drawn}>
      <Suspense fallback={drawn}>
        <Glb url={modelUrl} w={w} d={d} h={h} />
      </Suspense>
    </Fallback>
  );
}

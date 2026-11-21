// Draws a free-form MachineModel (src/model3d.ts): real materials, reflections, moving parts.
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MATERIALS, roofParts, type MachineModel, type MaterialName, type ModelPart } from '../model3d';

let hazardTexture: THREE.CanvasTexture | null = null;
function hazard(): THREE.CanvasTexture {
  if (hazardTexture) return hazardTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e0b020';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#17191c';
  for (let i = -64; i < 128; i += 32) {
    g.beginPath();
    g.moveTo(i, 64);
    g.lineTo(i + 16, 64);
    g.lineTo(i + 80, 0);
    g.lineTo(i + 64, 0);
    g.fill();
  }
  hazardTexture = new THREE.CanvasTexture(c);
  hazardTexture.wrapS = hazardTexture.wrapT = THREE.RepeatWrapping;
  hazardTexture.repeat.set(3, 1);
  return hazardTexture;
}

const cache = new Map<MaterialName, THREE.MeshStandardMaterial>();
function materialFor(name: MaterialName): THREE.MeshStandardMaterial {
  const hit = cache.get(name);
  if (hit) return hit;
  const def = MATERIALS[name] as { color: string; metalness: number; roughness: number; opacity?: number; emissive?: string; glow?: number };
  const m = new THREE.MeshStandardMaterial({
    color: name === 'hazard' ? '#ffffff' : def.color,
    map: name === 'hazard' ? hazard() : null,
    metalness: def.metalness,
    roughness: def.roughness,
    transparent: def.opacity !== undefined,
    opacity: def.opacity ?? 1,
    emissive: def.emissive ?? '#000000',
    emissiveIntensity: def.glow ?? 0,
  });
  cache.set(name, m);
  return m;
}

const unit = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 28),
  sphere: new THREE.SphereGeometry(0.5, 24, 16),
};
const rad = (d: number) => (d * Math.PI) / 180;

/** A roof drawn as a ghost: enough to show it is there, not enough to hide what is under it. */
const ghosts = new Map<MaterialName, THREE.MeshStandardMaterial>();
function ghostOf(name: MaterialName): THREE.MeshStandardMaterial {
  let m = ghosts.get(name);
  if (!m) {
    m = materialFor(name).clone();
    m.transparent = true;
    m.opacity = 0.14;
    m.depthWrite = false;
    ghosts.set(name, m);
  }
  return m;
}

function PartMesh({ part, animate, index, roof }: { part: ModelPart; animate: boolean; index: number; roof: boolean }) {
  const outer = useRef<THREE.Group>(null);
  const base = roof ? ghostOf(part.material) : materialFor(part.material);
  // a pulsing light gets its own material so it does not drag every other light with it
  const material = useMemo(() => (part.motion === 'pulse' ? base.clone() : base), [base, part.motion]);
  const see = base.transparent;
  const [a, b, c] = part.size;

  useFrame(({ clock }, delta) => {
    const g = outer.current;
    if (!g || !animate || part.motion === 'none') return;
    const t = clock.elapsedTime + index;
    if (part.motion === 'spin_x') g.rotation.x += delta * 5;
    else if (part.motion === 'spin_y') g.rotation.y += delta * 5;
    else if (part.motion === 'spin_z') g.rotation.z += delta * 5;
    else if (part.motion === 'bob') g.position.y = part.at[1] + Math.sin(t * 2.4) * Math.min(0.04, b * 0.25);
    else if (part.motion === 'pulse') material.emissiveIntensity = (MATERIALS[part.material] as { glow?: number }).glow ? 0.5 + (Math.sin(t * 3) + 1) * 0.7 : 0;
  });

  let mesh;
  if (part.shape === 'cone') {
    mesh = (
      <mesh material={material} castShadow={!see} receiveShadow>
        <cylinderGeometry args={[c / 2, a / 2, b, 28]} />
      </mesh>
    );
  } else if (part.shape === 'torus') {
    const tube = Math.min(b, a / 2) / 2;
    mesh = (
      <mesh material={material} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <torusGeometry args={[Math.max(0.001, a / 2 - tube), tube, 12, 32]} />
      </mesh>
    );
  } else {
    mesh = <mesh geometry={unit[part.shape]} material={material} scale={[a, b, c]} castShadow={!see} receiveShadow />;
  }
  return (
    <group ref={outer} position={part.at}>
      <group rotation={[rad(part.rot[0]), rad(part.rot[1]), rad(part.rot[2])]}>{mesh}</group>
    </group>
  );
}

export function ModelMesh({ model, animate = true }: { model: MachineModel; animate?: boolean }) {
  const roofs = useMemo(() => roofParts(model), [model]);
  return (
    <>
      {model.parts.map((p, i) => (
        <PartMesh key={i} part={p} animate={animate} index={i} roof={roofs.has(i)} />
      ))}
    </>
  );
}

/** Soft studio reflections so metal and glass read as metal and glass. No network: built in code. */
export function StudioEnv({ intensity = 0.55 }: { intensity?: number }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const target = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = target.texture;
    scene.environmentIntensity = intensity;
    return () => {
      scene.environment = null;
      target.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, intensity]);
  return null;
}

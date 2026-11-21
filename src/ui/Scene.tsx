import { Html, Line, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Routes } from '../engines/route';
import { centre, dockPoint, footprint, snap, type FactorySpec, type Point, type Station } from '../spec';

export interface Layers {
  flow: boolean;
  forklift: boolean;
  power: boolean;
  water: boolean;
  docks: boolean;
}

interface SceneProps {
  spec: FactorySpec;
  routes: Routes | null;
  layers: Layers;
  /** station ids to paint as invalid (while dragging) */
  badIds?: string[];
  bottleneck?: string;
  interactive?: boolean;
  onDrag?: (id: string, x: number, y: number) => void;
  onDrop?: (id: string) => void;
}

const TYPE_COLOURS: Record<string, string> = {
  storage: '#5b7a99',
  prep: '#3fa7a3',
  assembly: '#e0a03a',
  test: '#9a7bd1',
  pack: '#62b36b',
};
const colourFor = (type: string) => TYPE_COLOURS[type] ?? '#8a93a0';
const heightFor = (type: string) => (type === 'storage' ? 2.2 : 1);

type V3 = [number, number, number];

function useToWorld(spec: FactorySpec) {
  const { width, depth } = spec.floor;
  return (p: Point, y = 0): V3 => [p.x - width / 2, y, p.y - depth / 2];
}

function Floor({ spec }: { spec: FactorySpec }) {
  const { width, depth, cellSize } = spec.floor;
  const grid = useMemo(() => {
    const pts: number[] = [];
    for (let x = 0; x <= width + 1e-6; x += cellSize) pts.push(x - width / 2, 0.005, -depth / 2, x - width / 2, 0.005, depth / 2);
    for (let z = 0; z <= depth + 1e-6; z += cellSize) pts.push(-width / 2, 0.005, z - depth / 2, width / 2, 0.005, z - depth / 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [width, depth, cellSize]);
  const wallH = 0.5;
  const t = 0.12;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color="#20252c" roughness={0.95} />
      </mesh>
      <lineSegments geometry={grid}>
        <lineBasicMaterial color="#39414b" transparent opacity={0.55} />
      </lineSegments>
      {(
        [
          [0, -depth / 2 - t / 2, width + 2 * t, t],
          [0, depth / 2 + t / 2, width + 2 * t, t],
          [-width / 2 - t / 2, 0, t, depth],
          [width / 2 + t / 2, 0, t, depth],
        ] as const
      ).map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, wallH / 2, z]}>
          <boxGeometry args={[w, wallH, d]} />
          <meshStandardMaterial color="#4a5461" />
        </mesh>
      ))}
      <Html position={[0, 0.1, -depth / 2 - 1]} center className="compass">
        N
      </Html>
    </group>
  );
}

function StationBox({
  spec,
  s,
  bad,
  hot,
  interactive,
  onDrag,
  onDrop,
  setDragging,
}: {
  spec: FactorySpec;
  s: Station;
  bad: boolean;
  hot: boolean;
  interactive: boolean;
  onDrag?: SceneProps['onDrag'];
  onDrop?: SceneProps['onDrop'];
  setDragging: (v: boolean) => void;
}) {
  const toWorld = useToWorld(spec);
  const f = footprint(s);
  const h = heightFor(s.type);
  const [hover, setHover] = useState(false);
  const controls = useThree((st) => st.controls) as { enabled: boolean } | null;
  // Orbit controls listen on the same canvas, so switch them off synchronously: waiting
  // for a React render would let the first pointer moves orbit the camera.
  const lockCamera = (on: boolean) => {
    if (controls) controls.enabled = !on;
    setDragging(on);
  };
  const grab = useRef<{ dx: number; dy: number } | null>(null);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hit = useMemo(() => new THREE.Vector3(), []);

  const floorPoint = (e: ThreeEvent<PointerEvent>): Point | null => {
    if (!e.ray.intersectPlane(plane, hit)) return null;
    return { x: hit.x + spec.floor.width / 2, y: hit.z + spec.floor.depth / 2 };
  };

  const down = (e: ThreeEvent<PointerEvent>) => {
    if (!interactive) return;
    e.stopPropagation();
    const p = floorPoint(e);
    if (!p) return;
    grab.current = { dx: p.x - s.x, dy: p.y - s.y };
    (e.target as Element).setPointerCapture(e.pointerId);
    lockCamera(true);
  };
  const move = (e: ThreeEvent<PointerEvent>) => {
    if (!grab.current) return;
    e.stopPropagation();
    const p = floorPoint(e);
    if (!p) return;
    const cell = spec.floor.cellSize;
    const x = snap(p.x - grab.current.dx, cell);
    const y = snap(p.y - grab.current.dy, cell);
    if (x !== s.x || y !== s.y) onDrag?.(s.id, x, y);
  };
  const up = (e: ThreeEvent<PointerEvent>) => {
    if (!grab.current) return;
    e.stopPropagation();
    grab.current = null;
    (e.target as Element).releasePointerCapture(e.pointerId);
    lockCamera(false);
    onDrop?.(s.id);
  };

  const pos = toWorld({ x: f.x + f.w / 2, y: f.y + f.d / 2 }, h / 2);
  const colour = bad ? '#d9483b' : colourFor(s.type);
  return (
    <group position={pos}>
      <mesh
        castShadow
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerOver={() => interactive && setHover(true)}
        onPointerOut={() => setHover(false)}
      >
        <boxGeometry args={[f.w, h, f.d]} />
        <meshStandardMaterial color={colour} roughness={0.6} emissive={hover || hot ? colour : '#000000'} emissiveIntensity={hover ? 0.35 : hot ? 0.25 : 0} />
      </mesh>
      {hot && !bad && (
        <mesh position={[0, -h / 2 + 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[f.w + 0.5, f.d + 0.5]} />
          <meshBasicMaterial color="#ff6b4a" transparent opacity={0.35} />
        </mesh>
      )}
      <Html position={[0, h / 2 + 0.35, 0]} center className={`label${bad ? ' bad' : ''}${hot ? ' hot' : ''}`} zIndexRange={[10, 0]} pointerEvents="none" style={{ pointerEvents: 'none' }}>
        <b>{s.id}</b>
        <span>{s.type}</span>
      </Html>
    </group>
  );
}

function Docks({ spec }: { spec: FactorySpec }) {
  const toWorld = useToWorld(spec);
  return (
    <>
      {spec.docks.map((d, i) => {
        const p = dockPoint(spec, d);
        const alongX = d.wall === 'N' || d.wall === 'S';
        const kind = d.kind ?? (i === 0 ? 'in' : 'out');
        return (
          <group key={i} position={toWorld(p, 0.75)}>
            <mesh>
              <boxGeometry args={alongX ? [2, 1.5, 0.3] : [0.3, 1.5, 2]} />
              <meshStandardMaterial color={kind === 'in' ? '#4aa3ff' : '#ff9d4a'} emissive={kind === 'in' ? '#4aa3ff' : '#ff9d4a'} emissiveIntensity={0.3} />
            </mesh>
            <Html position={[0, 1.2, 0]} center className="label dock" zIndexRange={[10, 0]} pointerEvents="none" style={{ pointerEvents: 'none' }}>
              <b>dock {kind}</b>
            </Html>
          </group>
        );
      })}
    </>
  );
}

function Forklifts({ spec, routes }: { spec: FactorySpec; routes: Routes }) {
  const toWorld = useToWorld(spec);
  // One tour through the first path of each leg, as a polyline with cumulative lengths.
  const tour = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    const legs = [...new Set(routes.forklift.map((p) => p.leg))].sort((a, b) => a - b);
    for (const leg of legs) {
      const path = routes.forklift.find((p) => p.leg === leg)!;
      for (const p of path.points) pts.push(new THREE.Vector3(...toWorld(p, 0)));
    }
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    return { pts, cum, total: cum[cum.length - 1] ?? 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, spec.floor.width, spec.floor.depth]);
  const refs = useRef<(THREE.Group | null)[]>([]);
  const count = Math.max(1, spec.forklifts ?? 1);

  useFrame(({ clock }) => {
    if (tour.total <= 0) return;
    for (let k = 0; k < count; k++) {
      const g = refs.current[k];
      if (!g) continue;
      const dist = (clock.elapsedTime * 3 + (k * tour.total) / count) % tour.total;
      let i = 1;
      while (i < tour.cum.length - 1 && tour.cum[i] < dist) i++;
      const a = tour.pts[i - 1];
      const b = tour.pts[i];
      const seg = tour.cum[i] - tour.cum[i - 1];
      const t = seg > 0 ? (dist - tour.cum[i - 1]) / seg : 0;
      g.position.lerpVectors(a, b, t);
      if (seg > 1e-6) g.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
    }
  });

  return (
    <>
      {Array.from({ length: count }, (_, k) => (
        <group key={k} ref={(el) => void (refs.current[k] = el)}>
          <mesh position={[0, 0.35, 0]} castShadow>
            <boxGeometry args={[0.6, 0.5, 0.9]} />
            <meshStandardMaterial color="#f2c230" />
          </mesh>
          <mesh position={[0, 0.7, 0.4]}>
            <boxGeometry args={[0.5, 1.2, 0.08]} />
            <meshStandardMaterial color="#2b2f36" />
          </mesh>
          <mesh position={[0, 0.2, 0.75]}>
            <boxGeometry args={[0.5, 0.25, 0.5]} />
            <meshStandardMaterial color="#b98b5a" />
          </mesh>
        </group>
      ))}
    </>
  );
}

function Flow({ spec }: { spec: FactorySpec }) {
  const toWorld = useToWorld(spec);
  const segments = useMemo(() => {
    const out: { a: V3; b: V3 }[] = [];
    for (let i = 0; i < spec.routing.length - 1; i++) {
      const from = spec.stations.filter((s) => s.type === spec.routing[i]);
      const to = spec.stations.filter((s) => s.type === spec.routing[i + 1]);
      for (const a of from) for (const b of to) out.push({ a: toWorld(centre(a), heightFor(a.type) + 0.9), b: toWorld(centre(b), heightFor(b.type) + 0.9) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec]);
  return (
    <>
      {segments.map(({ a, b }, i) => {
        const va = new THREE.Vector3(...a);
        const vb = new THREE.Vector3(...b);
        const mid = va.clone().lerp(vb, 0.55);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
        return (
          <group key={i}>
            <Line points={[a, b]} color="#f4f1e8" lineWidth={2} dashed dashSize={0.4} gapSize={0.25} />
            <mesh position={mid} quaternion={q}>
              <coneGeometry args={[0.18, 0.5, 12]} />
              <meshBasicMaterial color="#f4f1e8" />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

function World({ spec, routes, layers, badIds = [], bottleneck, interactive = true, onDrag, onDrop }: SceneProps) {
  const toWorld = useToWorld(spec);
  const [dragging, setDragging] = useState(false);
  const span = Math.max(spec.floor.width, spec.floor.depth);
  return (
    <>
      <ambientLight intensity={0.75} />
      <directionalLight position={[span * 0.5, span, span * 0.3]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]}>
        <orthographicCamera attach="shadow-camera" args={[-span, span, span, -span, 0.1, span * 4]} />
      </directionalLight>
      <Floor spec={spec} />
      {spec.stations.map((s) => (
        <StationBox
          key={s.id}
          spec={spec}
          s={s}
          bad={badIds.includes(s.id)}
          hot={bottleneck === s.type}
          interactive={interactive}
          onDrag={onDrag}
          onDrop={onDrop}
          setDragging={setDragging}
        />
      ))}
      {layers.docks && <Docks spec={spec} />}
      {layers.forklift &&
        routes?.forklift.map((p, i) => (
          <Line key={`f${i}`} points={p.points.map((q) => toWorld(q, 0.04))} color="#f2c230" lineWidth={2.5} transparent opacity={0.85} />
        ))}
      {layers.forklift && routes && routes.forklift.length > 0 && !dragging && <Forklifts spec={spec} routes={routes} />}
      {layers.power &&
        routes?.power.map((r) => <Line key={`p${r.id}`} points={r.points.map((q) => toWorld(q, 0.09))} color="#ff5d5d" lineWidth={1.5} />)}
      {layers.water &&
        routes?.water.map((r) => <Line key={`w${r.id}`} points={r.points.map((q) => toWorld(q, 0.13))} color="#39b6ff" lineWidth={1.5} />)}
      {layers.power && (
        <mesh position={toWorld(spec.utilityEntry.power, 0.4)}>
          <boxGeometry args={[0.5, 0.8, 0.5]} />
          <meshStandardMaterial color="#ff5d5d" emissive="#ff5d5d" emissiveIntensity={0.4} />
        </mesh>
      )}
      {layers.water && (
        <mesh position={toWorld(spec.utilityEntry.water, 0.4)}>
          <cylinderGeometry args={[0.28, 0.28, 0.8, 16]} />
          <meshStandardMaterial color="#39b6ff" emissive="#39b6ff" emissiveIntensity={0.4} />
        </mesh>
      )}
      {layers.flow && <Flow spec={spec} />}
      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2.1} minDistance={5} maxDistance={span * 3} />
    </>
  );
}

export function Scene(props: SceneProps) {
  const span = Math.max(props.spec.floor.width, props.spec.floor.depth);
  return (
    <Canvas shadows camera={{ position: [span * 0.1, span * 1.0, span * 0.95], fov: 42 }} dpr={[1, 2]}>
      <color attach="background" args={['#14171c']} />
      <World {...props} />
    </Canvas>
  );
}

import { Billboard, Line, OrbitControls, Text } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Routes } from '../engines/route';
import { dockPoint, footprint, snap, type FactorySpec, type Point, type Station } from '../spec';
import type { MachineModel } from '../model3d';
import { BONE, Equipment, INK, ORANGE } from './Equipment';
import { StudioEnv } from './ModelMesh';

export interface Layers {
  flow: boolean;
  routes: boolean;
  power: boolean;
  water: boolean;
  labels: boolean;
}

export interface SceneProps {
  spec: FactorySpec;
  routes: Routes | null;
  layers: Layers;
  /** agent-built models by catalog id */
  models?: Record<string, MachineModel>;
  badIds?: string[];
  bottleneck?: string;
  selectedId?: string | null;
  interactive?: boolean;
  /** pixels of the canvas covered by a panel on the right; the floor is centred in what is left */
  insetRight?: number;
  animate?: boolean;
  onSelect?: (id: string | null) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  onDrop?: (id: string) => void;
}

type V3 = [number, number, number];
const RED = '#d1543f';

function useToWorld(spec: FactorySpec) {
  const { width, depth } = spec.floor;
  return (p: Point, y = 0): V3 => [p.x - width / 2, y, p.y - depth / 2];
}

function Label({ text, sub, y, tone }: { text: string; sub?: string; y: number; tone?: 'bad' | 'hot' }) {
  return (
    <Billboard position={[0, y, 0]}>
      <Text fontSize={0.3} color={tone ? RED : INK} anchorY="bottom" outlineWidth={0.06} outlineColor="#fffaf1" letterSpacing={0.01} renderOrder={20} material-depthTest={false} material-depthWrite={false}>
        {text}
      </Text>
      {sub && (
        <Text fontSize={0.2} color={tone ? RED : '#8a8172'} anchorY="top" position={[0, -0.04, 0]} outlineWidth={0.05} outlineColor="#fffaf1" renderOrder={20} material-depthTest={false} material-depthWrite={false}>
          {sub}
        </Text>
      )}
    </Billboard>
  );
}

function Floor({ spec }: { spec: FactorySpec }) {
  const { width, depth } = spec.floor;
  const grid = useMemo(() => {
    const pts: number[] = [];
    for (let x = 1; x < width; x += 1) pts.push(x - width / 2, 0.004, -depth / 2, x - width / 2, 0.004, depth / 2);
    for (let z = 1; z < depth; z += 1) pts.push(-width / 2, 0.004, z - depth / 2, width / 2, 0.004, z - depth / 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [width, depth]);
  return (
    <group>
      <mesh position={[0, -0.2, 0]} receiveShadow>
        <boxGeometry args={[width + 0.5, 0.4, depth + 0.5]} />
        <meshStandardMaterial color="#f7efe0" roughness={1} envMapIntensity={0.2} />
      </mesh>
      <mesh position={[0, -0.47, 0]}>
        <boxGeometry args={[width + 0.5, 0.14, depth + 0.5]} />
        <meshStandardMaterial color="#e6d6bd" roughness={1} />
      </mesh>
      <lineSegments geometry={grid}>
        <lineBasicMaterial color="#e9dcc6" />
      </lineSegments>
    </group>
  );
}

function StationNode({
  spec,
  s,
  bad,
  hot,
  selected,
  showLabel,
  label,
  model,
  animate,
  interactive,
  onSelect,
  onDrag,
  onDrop,
}: {
  spec: FactorySpec;
  s: Station;
  bad: boolean;
  hot: boolean;
  selected: boolean;
  showLabel: boolean;
  label: string;
  model?: MachineModel;
  animate: boolean;
  interactive: boolean;
  onSelect?: SceneProps['onSelect'];
  onDrag?: SceneProps['onDrag'];
  onDrop?: SceneProps['onDrop'];
}) {
  const toWorld = useToWorld(spec);
  const f = footprint(s);
  const h = model?.size.h ?? s.recipe?.size.h ?? s.height ?? (s.type === 'storage' ? 2.2 : 1);
  const [hover, setHover] = useState(false);
  const controls = useThree((st) => st.controls) as { enabled: boolean } | null;
  const grab = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);
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
    grab.current = { dx: p.x - s.x, dy: p.y - s.y, moved: false };
    (e.target as Element).setPointerCapture(e.pointerId);
    // orbit controls share the canvas: switch them off now, not on the next render
    if (controls) controls.enabled = false;
  };
  const move = (e: ThreeEvent<PointerEvent>) => {
    if (!grab.current) return;
    e.stopPropagation();
    const p = floorPoint(e);
    if (!p) return;
    const cell = spec.floor.cellSize;
    const x = snap(p.x - grab.current.dx, cell);
    const y = snap(p.y - grab.current.dy, cell);
    if (x !== s.x || y !== s.y) {
      grab.current.moved = true;
      onDrag?.(s.id, x, y);
    }
  };
  const up = (e: ThreeEvent<PointerEvent>) => {
    if (!grab.current) return;
    e.stopPropagation();
    const moved = grab.current.moved;
    grab.current = null;
    (e.target as Element).releasePointerCapture(e.pointerId);
    if (controls) controls.enabled = true;
    if (moved) onDrop?.(s.id);
    else onSelect?.(s.id);
  };

  const rotated = s.rot === 90 || s.rot === 270;
  const ring = bad ? RED : selected ? ORANGE : hot ? RED : hover ? '#cbb89a' : null;
  return (
    <group position={toWorld({ x: f.x + f.w / 2, y: f.y + f.d / 2 }, 0)}>
      {ring && (
        <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[f.w + 0.5, f.d + 0.5]} />
          <meshBasicMaterial color={ring} transparent opacity={bad ? 0.4 : selected ? 0.3 : hot ? 0.22 : 0.3} />
        </mesh>
      )}
      <group rotation={[0, rotated ? Math.PI / 2 : 0, 0]}>
        <Equipment type={s.type} shape={s.shape} recipe={s.recipe} model={model} w={s.w} d={s.d} h={h} modelUrl={s.modelUrl} animate={animate} />
      </group>
      {/* invisible grab box */}
      <mesh position={[0, h / 2, 0]} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerOver={() => interactive && setHover(true)} onPointerOut={() => setHover(false)}>
        <boxGeometry args={[f.w, h + 0.2, f.d]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {showLabel && (label || bad) && (
        <Label text={label || s.id} sub={bad ? 'not valid here' : hot ? 'bottleneck' : undefined} y={h + 0.75} tone={bad ? 'bad' : hot ? 'hot' : undefined} />
      )}
    </group>
  );
}

function Docks({ spec, showLabel }: { spec: FactorySpec; showLabel: boolean }) {
  const toWorld = useToWorld(spec);
  return (
    <>
      {spec.docks.map((d, i) => {
        const p = dockPoint(spec, d);
        const alongX = d.wall === 'N' || d.wall === 'S';
        const kind = d.kind ?? (i === 0 ? 'in' : 'out');
        const out = { N: [0, -0.4], S: [0, 0.4], W: [-0.4, 0], E: [0.4, 0] }[d.wall];
        return (
          <group key={i} position={toWorld(p, 0)}>
            <mesh position={[out[0] * 0.3, 0.02, out[1] * 0.3]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={alongX ? [2.4, 0.9] : [0.9, 2.4]} />
              <meshBasicMaterial color={kind === 'in' ? INK : ORANGE} />
            </mesh>
            {[-1.2, 1.2].map((o) => (
              <mesh key={o} position={[alongX ? o : out[0] * 0.5, 0.7, alongX ? out[1] * 0.5 : o]} castShadow>
                <boxGeometry args={[0.16, 1.4, 0.16]} />
                <meshStandardMaterial color={kind === 'in' ? INK : ORANGE} roughness={0.8} />
              </mesh>
            ))}
            {showLabel && <Label text={kind === 'in' ? 'Receiving' : 'Shipping'} y={1.7} />}
          </group>
        );
      })}
    </>
  );
}

/** One label per step, on its first station: "Assembly ×3", or "Test" when there is one. */
function labelFor(spec: FactorySpec, s: Station): string {
  const same = spec.stations.filter((x) => x.type === s.type);
  if (same[0] !== s) return '';
  const title = s.type.charAt(0).toUpperCase() + s.type.slice(1);
  return same.length > 1 ? `${title} ×${same.length}` : title;
}

interface Tour {
  pts: THREE.Vector3[];
  cum: number[];
  total: number;
}

/** One continuous path through the first route of every leg: dock in -> each step -> dock out. */
function useTour(spec: FactorySpec, routes: Routes | null): Tour {
  const { width, depth } = spec.floor;
  return useMemo(() => {
    const pts: THREE.Vector3[] = [];
    if (routes) {
      const legs = [...new Set(routes.forklift.map((p) => p.leg))].sort((a, b) => a - b);
      for (const leg of legs) for (const p of routes.forklift.find((x) => x.leg === leg)!.points) pts.push(new THREE.Vector3(p.x - width / 2, 0, p.y - depth / 2));
    }
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    return { pts, cum, total: cum[cum.length - 1] ?? 0 };
  }, [routes, width, depth]);
}

function Movers({ tour, carriers, hot }: { tour: Tour; carriers: number; hot: boolean }) {
  const refs = useRef<(THREE.Group | null)[]>([]);
  const dots = 9;
  const n = carriers + dots;
  const place = (dist: number, g: THREE.Group) => {
    let i = 1;
    while (i < tour.cum.length - 1 && tour.cum[i] < dist) i++;
    const a = tour.pts[i - 1];
    const b = tour.pts[i];
    const seg = tour.cum[i] - tour.cum[i - 1];
    g.position.lerpVectors(a, b, seg > 0 ? (dist - tour.cum[i - 1]) / seg : 0);
    if (seg > 1e-6) g.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
  };
  useFrame(({ clock }) => {
    if (tour.total <= 0) return;
    for (let k = 0; k < n; k++) {
      const g = refs.current[k];
      if (!g) continue;
      const isCarrier = k < carriers;
      const phase = isCarrier ? (k * tour.total) / carriers : ((k - carriers) * tour.total) / dots;
      place((clock.elapsedTime * (isCarrier ? 2.6 : 1.5) + phase) % tour.total, g);
    }
  });
  const palette = [ORANGE, '#4d9d74', '#e9b949', RED];
  return (
    <>
      {Array.from({ length: n }, (_, k) => (
        <group key={k} ref={(el) => void (refs.current[k] = el)}>
          {k < carriers ? (
            <>
              <mesh position={[0, 0.3, 0]} castShadow>
                <boxGeometry args={[0.62, 0.42, 0.95]} />
                <meshStandardMaterial color={hot ? RED : INK} roughness={0.8} />
              </mesh>
              <mesh position={[0, 0.72, -0.12]} castShadow>
                <boxGeometry args={[0.5, 0.42, 0.5]} />
                <meshStandardMaterial color={BONE} roughness={0.8} />
              </mesh>
              <mesh position={[0, 0.16, 0.62]} castShadow>
                <boxGeometry args={[0.5, 0.06, 0.5]} />
                <meshStandardMaterial color={ORANGE} roughness={0.8} />
              </mesh>
            </>
          ) : (
            <mesh position={[0, 0.13, 0]} castShadow>
              <boxGeometry args={[0.2, 0.2, 0.2]} />
              <meshStandardMaterial color={palette[k % palette.length]} roughness={0.8} />
            </mesh>
          )}
        </group>
      ))}
    </>
  );
}

function FitCamera({ spec, insetRight }: { spec: FactorySpec; insetRight: number }) {
  const { camera, size, controls } = useThree();
  const { width, depth } = spec.floor;
  useEffect(() => {
    const free = Math.max(320, size.width - insetRight);
    // the floor's on-screen width is (w + d) / sqrt(2); its height is about 0.47 of (w + d) at this camera angle, plus equipment
    const zoom = Math.min(free / ((width + depth) * 0.86), size.height / ((width + depth) * 0.7));
    // on screen, "right" is world (1, 0, -1) / sqrt(2) for this camera; shift the target so the floor sits in the free area
    const shift = insetRight / 2 / zoom / Math.SQRT2;
    const target = new THREE.Vector3(shift, 0, -shift);
    camera.position.set(target.x + 40, 50, target.z + 40);
    (camera as THREE.OrthographicCamera).zoom = zoom;
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    const c = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
    if (c) {
      c.target.copy(target);
      c.update();
    }
  }, [camera, controls, size.width, size.height, width, depth, insetRight]);
  return null;
}

function World({ spec, routes, layers, models, badIds = [], bottleneck, selectedId, interactive = true, insetRight = 0, animate = true, onSelect, onDrag, onDrop }: SceneProps) {
  const toWorld = useToWorld(spec);
  const tour = useTour(spec, routes);
  const span = Math.max(spec.floor.width, spec.floor.depth);
  return (
    <>
      <StudioEnv intensity={0.35} />
      <ambientLight intensity={1.0} />
      <directionalLight position={[-span * 0.4, span * 1.2, span * 0.5]} intensity={1.7} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0005}>
        <orthographicCamera attach="shadow-camera" args={[-span, span, span, -span, 0.1, span * 5]} />
      </directionalLight>
      <Floor spec={spec} />
      <mesh position={[0, -0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} onPointerDown={() => onSelect?.(null)}>
        <planeGeometry args={[spec.floor.width, spec.floor.depth]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {spec.stations.map((s) => (
        <StationNode
          key={s.id}
          spec={spec}
          s={s}
          bad={badIds.includes(s.id)}
          hot={bottleneck === s.type}
          selected={selectedId === s.id}
          showLabel={layers.labels}
          label={labelFor(spec, s)}
          model={s.catalogId ? models?.[s.catalogId] : undefined}
          animate={animate}
          interactive={interactive}
          onSelect={onSelect}
          onDrag={onDrag}
          onDrop={onDrop}
        />
      ))}
      <Docks spec={spec} showLabel={layers.labels} />
      {layers.routes && routes?.forklift.map((p, i) => <Line key={`r${i}`} points={p.points.map((q) => toWorld(q, 0.02))} color="#d8c7a8" lineWidth={2} />)}
      {layers.flow && tour.pts.length > 1 && <Line points={tour.pts.map((p) => [p.x, 0.03, p.z] as V3)} color={ORANGE} lineWidth={3.5} />}
      {layers.flow && animate && tour.total > 0 && <Movers tour={tour} carriers={Math.max(1, spec.forklifts ?? 1)} hot={bottleneck === 'forklift'} />}
      {layers.power && routes?.power.map((r) => <Line key={`p${r.id}`} points={r.points.map((q) => toWorld(q, 0.05))} color={RED} lineWidth={1.5} dashed dashSize={0.3} gapSize={0.2} />)}
      {layers.water && routes?.water.map((r) => <Line key={`w${r.id}`} points={r.points.map((q) => toWorld(q, 0.07))} color="#5b8fd6" lineWidth={1.5} dashed dashSize={0.3} gapSize={0.2} />)}
      {layers.power && (
        <mesh position={toWorld(spec.utilityEntry.power, 0.3)} castShadow>
          <boxGeometry args={[0.4, 0.6, 0.4]} />
          <meshStandardMaterial color={RED} roughness={0.8} />
        </mesh>
      )}
      {layers.water && (
        <mesh position={toWorld(spec.utilityEntry.water, 0.3)} castShadow>
          <cylinderGeometry args={[0.22, 0.22, 0.6, 16]} />
          <meshStandardMaterial color="#5b8fd6" roughness={0.8} />
        </mesh>
      )}
      <OrbitControls makeDefault enableRotate={interactive} enablePan={interactive} enableZoom={interactive} maxPolarAngle={Math.PI / 2.15} minZoom={8} maxZoom={160} />
      <FitCamera spec={spec} insetRight={insetRight} />
    </>
  );
}

export function Scene(props: SceneProps) {
  // r3f sizes the canvas from a measured container; nudge a re-measure once layout has settled
  useEffect(() => {
    const t = setTimeout(() => window.dispatchEvent(new Event('resize')), 80);
    return () => clearTimeout(t);
  }, []);
  return (
    <Canvas flat shadows orthographic camera={{ position: [40, 50, 40], zoom: 30, near: -200, far: 600 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
      <World {...props} />
    </Canvas>
  );
}

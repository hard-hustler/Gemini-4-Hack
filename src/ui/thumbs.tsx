// One hidden canvas renders every still picture of a machine: catalog thumbnails, and the
// renders the inspector compares with listing photos. (One WebGL context, jobs in a queue.)
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { OrthographicCamera } from 'three';
import type { CatalogItem } from '../contracts';
import type { MachineModel } from '../model3d';
import { Equipment } from './Equipment';
import { StudioEnv } from './ModelMesh';

const PX = 512;
type Job = { key: string; item: CatalogItem; done?: (url: string) => void };
const cache = new Map<string, string>();
const queue: Job[] = [];
const listeners = new Set<() => void>();
let version = 0;
const notify = () => {
  version++;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const keyOf = (i: CatalogItem) =>
  i.model ? `model|${i.model.name}|${i.model.parts.length}|${JSON.stringify(i.model.parts.slice(0, 6))}|${JSON.stringify(i.model.size)}` : `${i.stationType}|${i.shape ?? ''}|${i.footprint.w}x${i.footprint.d}x${i.footprint.h}|${i.modelUrl ?? ''}|${i.recipe ? JSON.stringify(i.recipe) : ''}`;

/** A PNG data URL of the item as drawn in 3D, or undefined until it has been rendered. */
export function useThumb(item: CatalogItem): string | undefined {
  const key = keyOf(item);
  useSyncExternalStore(subscribe, () => version);
  useEffect(() => {
    if (!cache.has(key) && !queue.some((j) => j.key === key)) {
      queue.push({ key, item });
      notify();
    }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return cache.get(key);
}

/** Render a free-form model to a PNG data URL: what the inspector is shown. */
export function renderModel(model: MachineModel): Promise<string> {
  const item: CatalogItem = { id: 'render', name: model.name, stationType: 'machine', footprint: model.size, cycleTimeSec: 1, operators: 0, powerKw: 0, needsWater: false, price: 0, source: 'shopify', model };
  const key = keyOf(item);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve) => {
    queue.push({ key, item, done: resolve });
    notify();
  });
}

function Shot({ job, onDone }: { job: Job; onDone: (url: string) => void }) {
  const { camera, gl, scene, size } = useThree();
  const { w, d, h } = job.item.model?.size ?? job.item.recipe?.size ?? job.item.footprint;
  // Render by hand once the parts are mounted; waiting on animation frames stalls in a background tab.
  useEffect(() => {
    const cam = camera as OrthographicCamera;
    cam.position.set(9, 8, 11);
    cam.zoom = size.width / Math.max((w + d) * 0.84, h * 1.45 + (w + d) * 0.34);
    cam.lookAt(0, h * 0.46, 0);
    cam.updateProjectionMatrix();
    // two ticks: the first lets the environment map and materials settle
    const t = setTimeout(() => {
      gl.render(scene, cam);
      onDone(gl.domElement.toDataURL('image/png'));
    }, 30);
    return () => clearTimeout(t);
  }, [job.key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <StudioEnv intensity={0.6} />
      <ambientLight intensity={0.9} />
      <directionalLight position={[-4, 10, 6]} intensity={1.9} />
      <directionalLight position={[6, 4, 8]} intensity={0.5} />
      <Equipment type={job.item.stationType} shape={job.item.shape} recipe={job.item.recipe} model={job.item.model} w={w} d={d} h={h} modelUrl={job.item.modelUrl} animate={false} />
    </>
  );
}

/** Mount once near the root. Invisible; drains the render queue. */
export function ThumbRenderer() {
  useSyncExternalStore(subscribe, () => version);
  const [job, setJob] = useState<Job | null>(null);
  useEffect(() => {
    if (!job && queue.length) setJob(queue[0]);
  });
  if (!job) return null;
  return (
    <div style={{ position: 'fixed', left: -PX - 40, top: 0, width: PX, height: PX, pointerEvents: 'none', opacity: 0 }} aria-hidden="true">
      <Canvas flat orthographic frameloop="never" dpr={1} gl={{ preserveDrawingBuffer: true, alpha: true, antialias: true }} camera={{ near: -100, far: 200 }}>
        <Shot
          key={job.key}
          job={job}
          onDone={(url) => {
            cache.set(job.key, url);
            queue.filter((j) => j.key === job.key).forEach((j) => j.done?.(url));
            for (let i = queue.length - 1; i >= 0; i--) if (queue[i].key === job.key) queue.splice(i, 1);
            notify();
            setJob(queue[0] ?? null);
          }}
        />
      </Canvas>
    </div>
  );
}

/** The item's rendered model in a square frame, with the listing photo inset when it came from one. */
export function MachineThumb({ item }: { item: CatalogItem }) {
  const rendered = useThumb(item);
  return (
    <span className="thumb">
      {rendered ? <img src={rendered} alt="" /> : null}
      {item.listing?.image && <img className="thumb-photo" src={item.listing.image} alt="Listing photo" title="The listing photo this was built from" />}
    </span>
  );
}

// ?capture: let a script on the page ask for renders, to save pictures of machines for the site
if (typeof window !== 'undefined' && new URLSearchParams(location.search).has('capture')) {
  (window as unknown as { __renderModel: typeof renderModel }).__renderModel = renderModel;
}

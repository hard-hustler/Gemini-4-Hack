// Equipment thumbnails rendered from the real 3D models, by one hidden canvas, one at a time.
// (One WebGL context for all thumbnails instead of one per row.)
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { OrthographicCamera } from 'three';
import type { CatalogItem } from '../contracts';
import { Equipment } from './Equipment';

type Job = { key: string; item: CatalogItem };
const cache = new Map<string, string>();
const queue: Job[] = [];
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
let version = 0;
const keyOf = (i: CatalogItem) => `${i.stationType}|${i.shape ?? ''}|${i.footprint.w}x${i.footprint.d}x${i.footprint.h}|${i.modelUrl ?? ''}|${i.recipe ? JSON.stringify(i.recipe) : ''}`;

/** A PNG data URL of the item's 3D model, or undefined until it has been rendered. */
export function useThumb(item: CatalogItem): string | undefined {
  const key = keyOf(item);
  useSyncExternalStore(subscribe, () => version);
  useEffect(() => {
    if (!cache.has(key) && !queue.some((j) => j.key === key)) {
      queue.push({ key, item });
      version++;
      notify();
    }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return cache.get(key);
}

function Shot({ job, onDone }: { job: Job; onDone: (url: string) => void }) {
  const { camera, gl, scene, size } = useThree();
  const { w, d, h } = job.item.recipe?.size ?? job.item.footprint;
  // Render once, by hand, as soon as the parts are mounted. Waiting on animation frames
  // would stall whenever the tab is in the background.
  useEffect(() => {
    const cam = camera as OrthographicCamera;
    cam.position.set(10, 9, 10);
    cam.zoom = size.width / Math.max((w + d) * 0.82, h * 1.5 + (w + d) * 0.35);
    cam.lookAt(0, h * 0.45, 0);
    cam.updateProjectionMatrix();
    const t = setTimeout(() => {
      gl.render(scene, cam);
      onDone(gl.domElement.toDataURL('image/png'));
    }, 0);
    return () => clearTimeout(t);
  }, [job.key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <ambientLight intensity={1.5} />
      <directionalLight position={[-4, 10, 5]} intensity={1.7} />
      <Equipment type={job.item.stationType} shape={job.item.shape} recipe={job.item.recipe} w={w} d={d} h={h} modelUrl={job.item.modelUrl} />
    </>
  );
}

/** Mount once near the root. Invisible; drains the thumbnail queue. */
export function ThumbRenderer() {
  useSyncExternalStore(subscribe, () => version);
  const [job, setJob] = useState<Job | null>(null);
  useEffect(() => {
    if (!job && queue.length) setJob(queue[0]);
  });
  if (!job) return null;
  return (
    <div style={{ position: 'fixed', left: -400, top: 0, width: 192, height: 192, pointerEvents: 'none', opacity: 0 }} aria-hidden="true">
      <Canvas flat orthographic frameloop="never" dpr={1} gl={{ preserveDrawingBuffer: true, alpha: true, antialias: true }} camera={{ near: -100, far: 200 }}>
        <Shot
          key={job.key}
          job={job}
          onDone={(url) => {
            cache.set(job.key, url);
            queue.shift();
            version++;
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

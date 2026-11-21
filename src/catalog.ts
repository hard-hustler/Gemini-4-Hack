// Built-in equipment catalog. SEAM: the catalog workstream replaces this file's data
// (and adds modelUrl per item). The harness only calls pickItem() and genericItem().

import type { CatalogItem, ProcessStep } from './contracts';

export const BUILTIN: CatalogItem[] = [
  { id: 'rack-std', name: 'Pallet rack, 3 m bay', stationType: 'storage', footprint: { w: 3, d: 1.5, h: 2.4 }, cycleTimeSec: 20, operators: 0, powerKw: 0, needsWater: false, price: 450, source: 'builtin', shape: 'rack' },
  { id: 'prep-sink', name: 'Prep table with sink', stationType: 'prep', footprint: { w: 2, d: 1, h: 0.9 }, cycleTimeSec: 80, operators: 1, powerKw: 1.5, needsWater: true, price: 600, source: 'builtin', shape: 'table' },
  { id: 'bench-asm', name: 'Assembly workbench', stationType: 'assembly', footprint: { w: 2.5, d: 1, h: 0.9 }, cycleTimeSec: 200, operators: 1, powerKw: 0.8, needsWater: false, price: 700, source: 'builtin', shape: 'bench' },
  { id: 'bench-esd', name: 'ESD test bench', stationType: 'test', footprint: { w: 2, d: 1, h: 0.9 }, cycleTimeSec: 90, operators: 1, powerKw: 2, needsWater: false, price: 1200, source: 'builtin', shape: 'machine' },
  { id: 'pack-table', name: 'Packing table', stationType: 'pack', footprint: { w: 2.5, d: 1.5, h: 0.9 }, cycleTimeSec: 70, operators: 1, powerKw: 0.5, needsWater: false, price: 500, source: 'builtin', shape: 'table' },
  { id: 'weld-cell', name: 'Welding cell', stationType: 'weld', footprint: { w: 2.5, d: 2, h: 2 }, cycleTimeSec: 150, operators: 1, powerKw: 6, needsWater: false, price: 4200, source: 'builtin', shape: 'machine' },
  { id: 'paint-booth', name: 'Spray booth', stationType: 'paint', footprint: { w: 3, d: 2, h: 2.2 }, cycleTimeSec: 180, operators: 1, powerKw: 3, needsWater: true, price: 5200, source: 'builtin', shape: 'machine' },
  { id: 'inspect-bench', name: 'Inspection bench', stationType: 'inspect', footprint: { w: 2, d: 1, h: 0.9 }, cycleTimeSec: 60, operators: 1, powerKw: 0.4, needsWater: false, price: 650, source: 'builtin', shape: 'bench' },
  { id: 'label-station', name: 'Labelling station', stationType: 'label', footprint: { w: 1.5, d: 1, h: 1.2 }, cycleTimeSec: 30, operators: 1, powerKw: 0.3, needsWater: false, price: 900, source: 'builtin', shape: 'machine' },
  { id: 'kitting-cart', name: 'Kitting bench', stationType: 'kitting', footprint: { w: 2, d: 1, h: 0.9 }, cycleTimeSec: 50, operators: 1, powerKw: 0, needsWater: false, price: 400, source: 'builtin', shape: 'bench' },
  { id: 'conveyor-3m', name: 'Roller conveyor, 3 m', stationType: 'conveyor', footprint: { w: 3, d: 0.5, h: 0.8 }, cycleTimeSec: 15, operators: 0, powerKw: 0.4, needsWater: false, price: 800, source: 'builtin', shape: 'conveyor' },
];

/** A catalog item for a step type the catalog does not know, built from the model's own estimates. */
export function genericItem(step: ProcessStep): CatalogItem {
  const half = (v: number) => Math.max(0.5, Math.round(v * 2) / 2);
  return {
    id: `generic-${step.type}`,
    name: step.label || step.type,
    stationType: step.type,
    footprint: { w: half(step.w || 2), d: half(step.d || 1), h: 1 },
    cycleTimeSec: Math.max(1, step.cycleTimeSec || 60),
    operators: step.operators ?? 1,
    powerKw: step.powerKw ?? 0,
    needsWater: !!step.needsWater,
    price: 800,
    source: 'builtin',
    shape: 'machine',
  };
}

/** The item for a step: catalog match with the step's own process numbers on top, else a generic one. */
export function pickItem(step: ProcessStep): CatalogItem {
  const hit = BUILTIN.find((c) => c.stationType === step.type);
  if (!hit) return genericItem(step);
  return { ...hit, cycleTimeSec: step.cycleTimeSec > 0 ? step.cycleTimeSec : hit.cycleTimeSec };
}

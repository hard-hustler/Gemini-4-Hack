import { describe, expect, it } from 'vitest';
import { workshop } from '../fixtures/workshop';
import { applyOp, applyOps, type FactorySpec } from '../spec';
import { cost } from './cost';
import { alreadyOnFloor, checkCites, plantFacts } from './facts';
import { route } from './route';
import { simulate, simulateOnce, type LineModel } from './simulate';
import { validate } from './validate';
import { compare, diffSpecs, evaluate } from './versions';

const codes = (s: FactorySpec) => validate(s).map((e) => e.code);

describe('validate', () => {
  it('accepts the fixture', () => {
    expect(validate(workshop)).toEqual([]);
  });
  it('reports overlaps with both ids', () => {
    const errs = validate(applyOp(workshop, { op: 'move', id: 'asm2', x: 14.5, y: 5.5 }));
    expect(errs[0].code).toBe('overlap');
    expect(errs[0].ids).toEqual(['asm1', 'asm2']);
  });
  it('reports a narrow aisle but allows flush placement', () => {
    expect(codes(applyOp(workshop, { op: 'move', id: 'asm2', x: 14, y: 6.5 }))).toContain('aisle');
    expect(codes(applyOp(workshop, { op: 'move', id: 'asm2', x: 14, y: 6 }))).toEqual([]);
  });
  it('reports out of bounds and bad docks', () => {
    expect(codes(applyOp(workshop, { op: 'move', id: 'rack1', x: 18, y: 1 }))).toContain('out_of_bounds');
    expect(codes(applyOp(workshop, { op: 'moveDock', index: 0, wall: 'N', offset: 25 }))).toContain('dock');
  });
  it('reports a station walled in by others', () => {
    const box = (id: string, x: number, y: number, w: number, d: number) =>
      ({ op: 'add', station: { ...workshop.stations[0], id, type: 'storage', x, y, w, d } }) as const;
    // rack1 sits in the NE corner; close it off on its west and south sides
    const spec = applyOps(workshop, [box('wallW', 15.5, 0, 0.5, 3), box('wallS', 16, 2.5, 4, 0.5), box('wallN', 16, 0, 4, 1)]);
    const errs = validate(spec);
    expect(errs.some((e) => e.code === 'unreachable' && e.ids.includes('rack1'))).toBe(true);
  });
  it('reports a routing type with no station', () => {
    expect(codes(applyOp(workshop, { op: 'remove', id: 'test1' }))).toContain('routing');
  });
});

describe('route', () => {
  const r = route(workshop);
  it('finds every leg', () => {
    expect(r.missing).toEqual([]);
    expect(r.legLengths).toHaveLength(workshop.routing.length + 1);
    expect(r.legLengths.every((l) => l > 0)).toBe(true);
  });
  it('paths are axis-aligned and never shorter than Manhattan distance', () => {
    for (const p of r.forklift) {
      const a = p.points[0];
      const b = p.points[p.points.length - 1];
      expect(p.length).toBeGreaterThanOrEqual(Math.abs(a.x - b.x) + Math.abs(a.y - b.y) - 1e-9);
      for (let i = 1; i < p.points.length; i++) {
        expect(p.points[i].x === p.points[i - 1].x || p.points[i].y === p.points[i - 1].y).toBe(true);
      }
    }
  });
  it('utility runs are Manhattan', () => {
    const prep = r.water.find((w) => w.id === 'prep1')!;
    expect(prep.length).toBeCloseTo(Math.abs(3 - 20) + Math.abs(6 - 13));
  });
});

describe('simulate', () => {
  it('is deterministic for a given seed set', () => {
    expect(simulate(workshop, 5)).toEqual(simulate(workshop, 5));
  });
  it('matches M/M/1 queue wait (Wq = rho / (mu - lambda))', () => {
    const model: LineModel = {
      stages: [{ name: 's', servers: [{ id: 's1', meanSec: 60 }] }],
      legs: [0, 0],
      arrivalsPerHour: 45,
      forklifts: 1,
      speedMps: 1,
      handlingSec: 0,
      service: 'exp',
      transport: false,
    };
    const runs = Array.from({ length: 20 }, (_, i) => simulateOnce(model, 42 + i, 400, 10));
    const wq = runs.reduce((t, x) => t + x.queueWaitSec[0], 0) / runs.length;
    const util = runs.reduce((t, x) => t + x.utilisation.s, 0) / runs.length;
    expect(util).toBeCloseTo(0.75, 1);
    expect(Math.abs(wq - 180) / 180).toBeLessThan(0.05);
  });
  it('throughput cannot exceed demand or capacity', () => {
    const s = simulate(workshop, 10);
    expect(s.unitsPerHour.median).toBeLessThanOrEqual(workshop.demandPerHour * 1.1);
    expect(s.unitsPerHour.low).toBeLessThanOrEqual(s.unitsPerHour.high);
  });
});

describe('cost and versions', () => {
  it('evaluates the fixture and refuses an invalid spec', () => {
    const ev = evaluate(workshop, 5);
    expect(ev.ok).toBe(true);
    const bad = evaluate(applyOp(workshop, { op: 'move', id: 'asm2', x: 14.5, y: 5.5 }), 5);
    expect(bad.ok).toBe(false);
  });
  it('a tighter layout costs less to build and moves the forklift less', () => {
    const better = applyOps(workshop, [
      { op: 'move', id: 'rack1', x: 2, y: 1 },
      { op: 'move', id: 'test1', x: 10, y: 5 },
    ]);
    const a = evaluate(workshop, 10);
    const b = evaluate(better, 10);
    if (!a.ok || !b.ok) throw new Error('expected both valid');
    const rows = compare(a.metrics, b.metrics);
    expect(rows.find((r) => r.key === 'fork')!.better).toBe(true);
    expect(diffSpecs(workshop, better)).toHaveLength(2);
    const r = route(workshop);
    expect(cost(workshop, a.metrics.sim, r).buildCost).toBeGreaterThan(4150);
  });
});

describe('localSearch', () => {
  it('improves the fixture, stays valid, and its ops reproduce the result', async () => {
    const { localSearch } = await import('./search');
    const r = localSearch(workshop, { iters: 150, seed: 2 });
    expect(r.score).toBeLessThan(1);
    expect(validate(r.spec)).toEqual([]);
    expect(applyOps(workshop, r.ops)).toEqual(r.spec);
  });
});

describe('buildLayout', () => {
  it('always returns a valid layout for a plan that fits, and says why when it cannot', async () => {
    const { buildLayout, PlaceError } = await import('./place');
    const { pickItem } = await import('../catalog');
    const step = (type: string, count: number) => ({ type, label: type, count, cycleTimeSec: 0, operators: 1, powerKw: 1, needsWater: false, w: 2, d: 1 });
    const steps = [step('storage', 1), step('prep', 1), step('assembly', 3), step('test', 2), step('pack', 1), step('laser', 1)];
    const req = { name: 't', summary: '', floor: { width: 18, depth: 12 }, demandPerHour: 30, steps, dockIn: 'W' as const, dockOut: 'E' as const, powerWall: 'N' as const, waterWall: 'S' as const, sketch: [], assumptions: [] };
    const equipment = steps.map((s) => ({ stepType: s.type, label: s.label, qty: s.count, item: pickItem(s) }));
    const r = buildLayout(req, equipment, { polish: false });
    expect(validate(r.spec)).toEqual([]);
    expect(r.spec.stations).toHaveLength(9);
    expect(r.spec.docks.map((d) => d.wall)).toEqual(['W', 'E']);
    expect(() => buildLayout({ ...req, floor: { width: 6, depth: 5 } }, equipment)).toThrow(PlaceError);
  });
});

describe('machine recipes', () => {
  it('every archetype builds inside its envelope with every feature it allows', async () => {
    const { ARCHETYPES, ARCHETYPE_NAMES, buildParts, checkRecipe, partsBounds, repairRecipe } = await import('../machines');
    for (const archetype of ARCHETYPE_NAMES) {
      for (const size of [{ w: 1.2, d: 0.6, h: 1.6 }, { w: 3, d: 1.5, h: 2.4 }, { w: 0.8, d: 0.8, h: 2 }]) {
        const raw = { archetype, size, workHeight: 0.9, colors: { frame: 'ink', surface: 'wood', body: 'bone', accent: 'orange' }, features: ARCHETYPES[archetype].features.map((kind) => ({ kind, count: 2 })), operatorSide: 'front' } as const;
        const { recipe } = repairRecipe(raw as never);
        expect(checkRecipe(recipe), `${archetype} ${JSON.stringify(size)}`).toEqual([]);
        const parts = buildParts(recipe);
        expect(parts.length).toBeGreaterThan(2);
        const b = partsBounds(parts);
        const { w, d, h } = recipe.size;
        // the stool, casters and a control box may sit just outside the footprint; nothing else may
        expect(b.maxY, `${archetype} height`).toBeLessThanOrEqual(h + 0.02);
        expect(b.minY).toBeGreaterThanOrEqual(-0.001);
        expect(Math.max(-b.minX, b.maxX), `${archetype} width`).toBeLessThanOrEqual(w / 2 + 0.2);
        expect(Math.max(-b.minZ, b.maxZ), `${archetype} depth`).toBeLessThanOrEqual(d / 2 + 0.5);
        for (const q of parts) expect(q.size.every((v) => v > 0 && Number.isFinite(v)), `${archetype} part size`).toBe(true);
      }
    }
  });
  it('rejects what cannot be built and says how to fix it', async () => {
    const { checkRecipe, normaliseRecipe, repairRecipe } = await import('../machines');
    const bad = normaliseRecipe({ archetype: 'bench', size: { w: 1.5, d: 0.7, h: 0.9 }, workHeight: 0.9, features: [{ kind: 'backboard', count: 1 }, { kind: 'hopper', count: 1 }, { kind: 'drawers', count: 8 }] });
    const errs = checkRecipe(bad);
    expect(errs.some((e) => e.includes('cannot have "hopper"'))).toBe(true);
    expect(errs.some((e) => e.includes('rises above the work surface'))).toBe(true);
    expect(errs.some((e) => e.includes('drawers need'))).toBe(true);
    const fixed = repairRecipe(bad);
    expect(checkRecipe(fixed.recipe)).toEqual([]);
    expect(fixed.dropped).toEqual(expect.arrayContaining(['hopper', 'backboard']));
    expect(normaliseRecipe({ archetype: 'spaceship', features: [{ kind: 'lasers' }] }).archetype).toBe('machine');
  });
});

describe('free-form machine models', () => {
  const part = (label: string, size: [number, number, number], at: [number, number, number], extra = {}) => ({ label, shape: 'box', size, at, rot: [0, 0, 0], material: 'steel', motion: 'none', ...extra });
  const table = () => [
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => part(`leg ${sx} ${sz}`, [0.05, 0.8, 0.05], [sx * 0.55, 0.4, sz * 0.25]))),
    part('top', [1.2, 0.05, 0.6], [0, 0.825, 0]),
    ...Array.from({ length: 10 }, (_, i) => part(`box ${i}`, [0.08, 0.08, 0.08], [-0.5 + i * 0.1, 0.89, 0])),
  ];
  it('accepts a connected model and rejects a floating part, naming it', async () => {
    const { checkModel, normaliseModel } = await import('../model3d');
    const good = normaliseModel({ name: 'table', size: { w: 1.2, d: 0.6, h: 0.93 }, parts: table() }, { w: 1, d: 1, h: 1 });
    expect(checkModel(good)).toEqual([]);
    const bad = normaliseModel({ name: 'table', size: { w: 1.2, d: 0.6, h: 0.93 }, parts: [...table().slice(0, -1), part('lamp', [0.08, 0.08, 0.08], [0, 0.89, 0.6])] }, { w: 1, d: 1, h: 1 });
    const errs = checkModel(bad);
    expect(errs.some((e) => e.includes('float') && e.includes('"lamp"'))).toBe(true);
  });
  it('rejects a model that does not fit its envelope or has too few parts', async () => {
    const { checkModel, normaliseModel } = await import('../model3d');
    const m = normaliseModel({ name: 'x', size: { w: 3, d: 0.6, h: 0.93 }, parts: table().slice(0, 6) }, { w: 1, d: 1, h: 1 });
    const errs = checkModel(m);
    expect(errs.some((e) => e.includes('only 6 parts'))).toBe(true);
    expect(errs.some((e) => e.includes('width (x)'))).toBe(true);
  });
  it('fitModel stands the model on the floor, centred, at exactly its stated size', async () => {
    const { fitModel, modelBox, normaliseModel } = await import('../model3d');
    const shifted = table().map((p) => ({ ...p, at: [p.at[0] + 0.3, p.at[1] + 0.02, p.at[2] - 0.1] }));
    const fitted = fitModel(normaliseModel({ name: 't', size: { w: 1.3, d: 0.65, h: 1 }, parts: shifted }, { w: 1, d: 1, h: 1 }));
    const b = modelBox(fitted.parts);
    expect(b.min[1]).toBeCloseTo(0, 2);
    expect(b.max[0] - b.min[0]).toBeCloseTo(1.3, 2);
    expect(b.max[1] - b.min[1]).toBeCloseTo(1, 2);
    expect(b.max[2] - b.min[2]).toBeCloseTo(0.65, 2);
    expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(0, 2);
  });
});

describe('conveyor routing', () => {
  const belt: FactorySpec = { ...workshop, transport: 'conveyor' };
  it('lays shared belt once, so the belt is shorter than the sum of the paths riding it', () => {
    const fork = route(workshop);
    const conv = route(belt);
    expect(conv.missing).toEqual([]);
    expect(conv.forklift.length).toBe(fork.forklift.length);
    const ridden = conv.forklift.reduce((t, p) => t + p.length, 0);
    expect(conv.totals.pathM).toBeGreaterThan(0);
    expect(conv.totals.pathM).toBeLessThanOrEqual(ridden);
  });
  it('still connects every leg end to end with axis-aligned runs', () => {
    for (const p of route(belt).forklift) {
      expect(p.points.length).toBeGreaterThanOrEqual(1);
      for (let i = 1; i < p.points.length; i++) {
        const a = p.points[i - 1];
        const b = p.points[i];
        expect(a.x === b.x || a.y === b.y).toBe(true);
      }
    }
  });
  it('never makes a unit travel further than twice the forklift route', () => {
    // sharing a trunk is a detour, and the simulator charges for it: keep the detour bounded
    expect(route(belt).totals.forkliftM).toBeLessThanOrEqual(route(workshop).totals.forkliftM * 2);
  });
});

describe('quoted facts', () => {
  const ev = evaluate(workshop, 6);
  if (!ev.ok) throw new Error('fixture must evaluate');
  const facts = plantFacts(workshop, ev.metrics, ev.routes);
  const st = workshop.stations[2];
  const real = facts.machines.get(st.id)!;

  it('accepts a number quoted correctly, within rounding', () => {
    const out = checkCites(
      [
        { machine: st.id, fact: 'power_kw', value: st.powerKw },
        { machine: st.id, fact: 'nearest_gap_m', value: Math.round(real.nearest_gap_m! * 10) / 10 },
        { machine: 'plant', fact: 'floor_width_m', value: workshop.floor.width },
        { machine: 'plant', fact: 'demand_per_hour', value: workshop.demandPerHour },
      ],
      facts,
    );
    expect(out.wrong).toEqual([]);
    expect(out.checked).toBe(4);
  });
  it('rejects a misquoted number, an unknown machine and a fact the machine does not have', () => {
    expect(checkCites([{ machine: st.id, fact: 'nearest_gap_m', value: real.nearest_gap_m! + 3 }], facts).wrong).toHaveLength(1);
    expect(checkCites([{ machine: 'lathe99', fact: 'power_kw', value: 5 }], facts).wrong[0]).toMatch(/not a machine/);
    expect(checkCites([{ machine: st.id, fact: 'conveyor_m', value: 10 }], facts).wrong[0]).toMatch(/has no/);
    expect(checkCites([{ machine: 'plant', fact: 'machine_count', value: workshop.stations.length + 1 }], facts).wrong).toHaveLength(1);
  });
  it('knows when a unit said to be missing is already on the floor', () => {
    const withCompressor: FactorySpec = { ...workshop, stations: [...workshop.stations, { ...st, id: 'screwcompressor1', type: 'screwcompressor', name: 'Screw compressor with dryer', x: 0, y: 0 }] };
    expect(alreadyOnFloor(withCompressor, '22 kW rotary screw compressor')).toBe('screwcompressor1');
    expect(alreadyOnFloor(workshop, '22 kW rotary screw compressor')).toBeNull();
    expect(alreadyOnFloor(workshop, 'Plumbed eye-wash station')).toBeNull();
    // a shared word is not the same unit: a water-leak test booth is not an oil-water separator
    const withBooth: FactorySpec = { ...workshop, stations: [...workshop.stations, { ...st, id: 'watertest1', type: 'watertest', name: 'Water-leak test booth', x: 0, y: 0 }] };
    expect(alreadyOnFloor(withBooth, 'Coalescing oil-water separator')).toBeNull();
    expect(alreadyOnFloor(withCompressor, 'Oil-free screw compressor with refrigerated dryer and 500 L receiver')).toBe('screwcompressor1');
  });
});

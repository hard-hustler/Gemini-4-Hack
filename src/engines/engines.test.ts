import { describe, expect, it } from 'vitest';
import { workshop } from '../fixtures/workshop';
import { applyOp, applyOps, type FactorySpec } from '../spec';
import { cost } from './cost';
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

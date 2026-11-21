import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { workshop } from '../fixtures/workshop';
import { applyOp, applyOps } from '../spec';
import {
  ADVOCATE_CHARACTERS,
  ADVOCATE_ROLES,
  buildDeterministicFixCandidates,
  computeCharacterWalkPlans,
  countAccessibleSides,
  runDeterministicAdvocateAudit,
  wallPinches,
} from './advocate';
import { buildGrid, isFree, pointToCell } from './grid';
import { validate } from './validate';
import { evaluate } from './versions';

describe('advocate engine', () => {
  it('defines all 5 devil’s advocate specialists plus Elena Vasquez fixer with valid voices', () => {
    for (const role of [...ADVOCATE_ROLES, 'fixer'] as const) {
      const c = ADVOCATE_CHARACTERS[role];
      assert.ok(c.name.length > 0);
      assert.ok(['Orus', 'Pulcherrima', 'Sadaltager', 'Erinome', 'Algenib', 'Sulafat'].includes(c.voice));
    }
  });

  it('audits the demo workshop floor and computes valid obstacle-free A* character walk plans', () => {
    const ev = evaluate(workshop, 10);
    assert.equal(ev.ok, true);
    if (!ev.ok) return;

    const report = runDeterministicAdvocateAudit(workshop, ev.metrics, ev.routes);
    assert.equal(report.agentVerdicts.length, 5);
    assert.equal(report.walkPlans.length, 5);
    assert.ok(report.findings.length > 0, 'Expected at least one critique on the demo workshop');

    const grid = buildGrid(workshop);
    const stands = new Set<string>();
    for (const plan of report.walkPlans) {
      assert.ok(plan.path.length >= 1, `Character ${plan.role} must have a walk path`);
      for (const pt of plan.path) {
        assert.ok(pt.x >= 0 && pt.x <= workshop.floor.width);
        assert.ok(pt.y >= 0 && pt.y <= workshop.floor.depth);
        const cell = pointToCell(grid, pt);
        assert.equal(isFree(grid, cell.c, cell.r), true, `Waypoint (${pt.x},${pt.y}) for ${plan.role} must be on a free cell`);
      }
      const standKey = `${plan.standPoint.x.toFixed(2)},${plan.standPoint.y.toFixed(2)}`;
      assert.equal(stands.has(standKey), false, `Characters must not overlap at ${standKey}`);
      stands.add(standKey);
    }
  });

  it('detects outer-wall clearance pinch traps (safety) and generates a legal fix', () => {
    // Move pack1 to 0.5m off the north wall, clear of other stations (legal under validate(), but a real safety pinch trap)
    const pinchedSpec = applyOp(workshop, { op: 'move', id: 'pack1', x: 8, y: 0.5 });
    assert.equal(validate(pinchedSpec).length, 0);
    assert.ok(wallPinches(pinchedSpec, pinchedSpec.stations.find((s) => s.id === 'pack1')!).length > 0);

    const ev = evaluate(pinchedSpec, 10);
    assert.equal(ev.ok, true);
    if (!ev.ok) return;

    const report = runDeterministicAdvocateAudit(pinchedSpec, ev.metrics, ev.routes);
    const pinchFinding = report.findings.find((f) => f.id.startsWith('safety-wall-pinch-'));
    assert.ok(pinchFinding, 'Nadia Okafor must flag sub-1.2m wall clearance pinch');
    assert.equal(pinchFinding.role, 'safety');

    const fixes = buildDeterministicFixCandidates(pinchedSpec, [pinchFinding]);
    assert.ok(fixes.length > 0, 'Expected a deterministic legal fix for wall pinch');
    for (const fix of fixes) {
      assert.equal(validate(fix.spec).length, 0);
    }
  });

  it('detects +20% demand surge collapse (stress) and proposes a parallel-station relief fix', () => {
    // Raise demand so the line barely runs at baseline and breaks under +20% surge
    const tight = applyOp(workshop, { op: 'setParam', path: 'demandPerHour', value: 38 });
    const ev = evaluate(tight, 10);
    assert.equal(ev.ok, true);
    if (!ev.ok) return;

    const report = runDeterministicAdvocateAudit(tight, ev.metrics, ev.routes);
    const stressFinding = report.findings.find((f) => f.role === 'stress');
    assert.ok(stressFinding, 'Marcus Cole must flag throughput/surge saturation');

    const fixes = buildDeterministicFixCandidates(tight, [stressFinding]);
    assert.ok(fixes.length > 0);
    assert.equal(validate(fixes[0].spec).length, 0);
  });

  it('detects excess idle forklifts (CFO) and trims opex cleanly', () => {
    const overForked = applyOp(workshop, { op: 'setParam', path: 'forklifts', value: 4 });
    const ev = evaluate(overForked, 10);
    assert.equal(ev.ok, true);
    if (!ev.ok) return;

    const report = runDeterministicAdvocateAudit(overForked, ev.metrics, ev.routes);
    const cfoFinding = report.findings.find((f) => f.id === 'cfo-excess-forklift');
    assert.ok(cfoFinding, 'Victor Chen must flag excess idle forklifts');

    const fixes = buildDeterministicFixCandidates(overForked, [cfoFinding]);
    assert.ok(fixes.some((fx) => (fx.spec.forklifts ?? 1) === 3));
  });

  it('detects boxed-in maintenance traps and plans Elena Vasquez fixer route', () => {
    // Push prep1 flush into the NW corner with a neighboring bench right next to it
    const cramped = applyOps(workshop, [
      { op: 'move', id: 'prep1', x: 0, y: 0 },
      { op: 'move', id: 'test1', x: 2, y: 0 },
    ]);
    const grid = buildGrid(cramped);
    const prepIdx = cramped.stations.findIndex((s) => s.id === 'prep1');
    const sides = countAccessibleSides(cramped, grid, prepIdx);
    assert.equal(sides.openSides, 1);

    const ev = evaluate(cramped, 8);
    assert.equal(ev.ok, true);
    if (!ev.ok) return;

    const report = runDeterministicAdvocateAudit(cramped, ev.metrics, ev.routes);
    assert.ok(report.findings.some((f) => f.id === 'maintenance-boxed-prep1'));

    const plansWithFixer = computeCharacterWalkPlans(cramped, report.findings, ['prep1']);
    assert.equal(plansWithFixer.length, 6);
    const elena = plansWithFixer.find((p) => p.role === 'fixer');
    assert.ok(elena && elena.targetId === 'prep1' && elena.path.length >= 1);
  });
});

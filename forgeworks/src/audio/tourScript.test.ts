import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLiveTourScript } from './tourScript';
import { FactorySimulation } from '../engine/simulation';
import { createDemoFactory } from '../engine/demoFactory';

test('live tour narrator dynamically reflects real factory counts, power, and throughput', () => {
  const sim = new FactorySimulation(createDemoFactory());
  for (let i = 0; i < 600; i++) {
    sim.step();
  }
  const snap = sim.buildSnapshot();

  const overview = buildLiveTourScript('overview', snap.entities, snap.metrics);
  assert.equal(overview.speakerName, 'Elena Vance');
  assert.ok(overview.text.includes(`${snap.entities.length} industrial machines`));
  assert.ok(overview.estimatedDurationMs >= 5500);

  const power = buildLiveTourScript('power', snap.entities, snap.metrics);
  assert.ok(power.text.includes('6 turbine generators'));
  assert.ok(power.text.includes('1560 kilowatts'));
  assert.ok(power.text.includes('rock solid'));

  const mining = buildLiveTourScript('mining', snap.entities, snap.metrics);
  assert.ok(mining.text.includes('Iron Ore'));

  const smelting = buildLiveTourScript('smelting', snap.entities, snap.metrics);
  assert.ok(smelting.text.includes('Steel Plates'));

  const shipping = buildLiveTourScript('shipping', snap.entities, snap.metrics);
  assert.ok(shipping.text.includes('Robot Parts'));
  assert.ok(shipping.text.includes('loading docks'));
});

test('live tour narrator warns user when factory power grid enters brownout', () => {
  const sim = new FactorySimulation(createDemoFactory());
  sim.step();
  const snap = sim.buildSnapshot();
  const brownoutMetrics = {
    ...snap.metrics,
    powerSatisfaction: 0.65,
    powerSupplyKW: 900,
    powerDemandKW: 1400,
  };

  const power = buildLiveTourScript('power', snap.entities, brownoutMetrics);
  assert.ok(power.text.includes('brownout at 65 percent'));
});

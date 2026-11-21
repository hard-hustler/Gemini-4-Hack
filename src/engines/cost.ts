import type { FactorySpec } from '../spec';
import type { Routes } from './route';
import type { SimResult } from './simulate';

export interface CostResult {
  buildCost: number;
  equipmentCost: number;
  utilityRunCost: number;
  costPerUnit: number;
  kwhPerUnit: number;
  forkliftMPerHour: number;
  runCostPerHour: number;
}

export function cost(spec: FactorySpec, sim: SimResult, routes: Routes): CostResult {
  const equipmentCost = spec.stations.reduce((t, s) => t + s.price, 0);
  const utilityRunCost = routes.totals.powerM * spec.costs.powerRunPerM + routes.totals.waterM * spec.costs.waterRunPerM;

  const forklifts = Math.max(1, spec.forklifts ?? 1);
  const operators = spec.stations.reduce((t, s) => t + s.operators, 0) + forklifts;
  // a station draws its rated power while it is working
  const kwhPerHour = spec.stations.reduce((t, s) => t + s.powerKw * (sim.utilisation[s.type] ?? 0), 0);
  const runCostPerHour = operators * spec.costs.labourPerHour + kwhPerHour * spec.costs.electricityPerKwh;
  const uph = sim.unitsPerHour.median;

  return {
    buildCost: equipmentCost + utilityRunCost,
    equipmentCost,
    utilityRunCost,
    costPerUnit: uph > 0 ? runCostPerHour / uph : Infinity,
    kwhPerUnit: uph > 0 ? kwhPerHour / uph : Infinity,
    forkliftMPerHour: sim.forkliftMPerHour,
    runCostPerHour,
  };
}

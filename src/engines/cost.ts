import type { FactorySpec } from '../spec';
import type { Routes } from './route';
import type { SimResult } from './simulate';

export interface CostResult {
  buildCost: number;
  equipmentCost: number;
  utilityRunCost: number;
  conveyorCost?: number;
  costPerUnit: number;
  kwhPerUnit: number;
  forkliftMPerHour: number;
  runCostPerHour: number;
}

const CONVEYOR_PER_M = 420;
const CONVEYOR_KW_PER_M = 0.12;

export function cost(spec: FactorySpec, sim: SimResult, routes: Routes): CostResult {
  const conveyor = spec.transport === 'conveyor';
  const equipmentCost = spec.stations.reduce((t, s) => t + s.price, 0);
  const conveyorCost = conveyor ? (routes.totals.pathM ?? 0) * (spec.costs.conveyorPerM ?? CONVEYOR_PER_M) : 0;
  const utilityRunCost = routes.totals.powerM * spec.costs.powerRunPerM + routes.totals.waterM * spec.costs.waterRunPerM;

  const forklifts = conveyor ? 0 : Math.max(1, spec.forklifts ?? 1);
  const operators = spec.stations.reduce((t, s) => t + s.operators, 0) + forklifts;
  // a station draws its rated power while it is working; a conveyor draws all the time
  const kwhPerHour = spec.stations.reduce((t, s) => t + s.powerKw * (sim.utilisation[s.type] ?? 0), 0) + (conveyor ? (routes.totals.pathM ?? 0) * CONVEYOR_KW_PER_M : 0);
  const runCostPerHour = operators * spec.costs.labourPerHour + kwhPerHour * spec.costs.electricityPerKwh;
  const uph = sim.unitsPerHour.median;

  return {
    buildCost: equipmentCost + utilityRunCost + conveyorCost,
    equipmentCost,
    utilityRunCost,
    conveyorCost,
    costPerUnit: uph > 0 ? runCostPerHour / uph : Infinity,
    kwhPerUnit: uph > 0 ? kwhPerHour / uph : Infinity,
    forkliftMPerHour: conveyor ? 0 : sim.forkliftMPerHour,
    runCostPerHour,
  };
}

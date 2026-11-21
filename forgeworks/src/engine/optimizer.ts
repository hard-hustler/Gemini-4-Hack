import { MACHINES, RECIPES } from '../data/catalog';
import {
  MachineEntity,
  OptimizationSuggestion,
  SimMetrics,
} from '../types/factory';

export function analyzeFactoryLayout(
  entities: MachineEntity[],
  metrics: SimMetrics
): OptimizationSuggestion[] {
  const suggestions: OptimizationSuggestion[] = [];

  // 1. Power grid deficit
  if (metrics.powerDemandKW > metrics.powerSupplyKW) {
    const deficit = metrics.powerDemandKW - metrics.powerSupplyKW;
    const gensNeeded = Math.ceil(deficit / MACHINES.generator.powerGenKW);
    suggestions.push({
      id: 'power-deficit',
      severity: 'critical',
      title: `Grid Brownout (${Math.round(metrics.powerSatisfaction * 100)}% output)`,
      detail: `Power demand (${metrics.powerDemandKW} kW) exceeds supply (${metrics.powerSupplyKW} kW) by ${deficit} kW. Add ${gensNeeded} Power Generator(s) fed with Coal to eliminate brownout slowdown.`,
    });
  }

  // 2. Unpowered machines outside pole radius
  const unpowered = entities.filter(
    (e) => e.status === 'no_power' && e.type !== 'power_pole'
  );
  if (unpowered.length > 0) {
    const sample = unpowered[0];
    suggestions.push({
      id: `unpowered-${sample.id}`,
      severity: 'critical',
      title: `${unpowered.length} Machine(s) Unpowered`,
      detail: `${MACHINES[sample.type].name} #${sample.id} at (${sample.x}, ${sample.z}) is outside Power Pole coverage. Place a Power Pole within 5 tiles connected to the grid.`,
      targetX: sample.x,
      targetZ: sample.z,
      machineId: sample.id,
    });
  }

  // 3. Active breakdowns
  const broken = entities.filter((e) => e.status === 'broken');
  if (broken.length > 0) {
    const m = broken[0];
    suggestions.push({
      id: `broken-${m.id}`,
      severity: 'warning',
      title: `${broken.length} Breakdown(s) Under Drone Repair`,
      detail: `${MACHINES[m.type].name} #${m.id} at (${m.x}, ${m.z}) broke from mechanical wear. A maintenance drone is routing via A* to repair it.`,
      targetX: m.x,
      targetZ: m.z,
      machineId: m.id,
    });
  }

  // 4. Starved or blocked Smelters & Assemblers
  const processors = entities
    .filter(
      (e) => (e.type === 'smelter' || e.type === 'assembler') && e.totalTicks > 40
    )
    .sort((a, b) => {
      const aRatio = Math.max(a.starvedTicks, a.blockedTicks) / a.totalTicks;
      const bRatio = Math.max(b.starvedTicks, b.blockedTicks) / b.totalTicks;
      return bRatio - aRatio;
    });

  for (const m of processors) {
    const starvedPct = Math.round((m.starvedTicks / m.totalTicks) * 100);
    const blockedPct = Math.round((m.blockedTicks / m.totalTicks) * 100);
    const recipe = m.recipeId ? RECIPES[m.recipeId] : null;
    const recipeName = recipe ? recipe.name : 'Unassigned';

    if (starvedPct >= 25) {
      const neededInputs = recipe
        ? recipe.inputs.map((i) => `${i.count}x ${i.item.replace('_', ' ')}`).join(' + ')
        : 'raw inputs';
      suggestions.push({
        id: `starved-${m.id}`,
        severity: starvedPct >= 55 ? 'critical' : 'warning',
        title: `${MACHINES[m.type].shortName} #${m.id} Starved ${starvedPct}%`,
        detail: `${MACHINES[m.type].name} #${m.id} at (${m.x}, ${m.z}) crafting ${recipeName} is starved ${starvedPct}% of ticks. Supply more ${neededInputs} by adding an upstream Extractor/Smelter feeding this conveyor line.`,
        targetX: m.x,
        targetZ: m.z,
        machineId: m.id,
      });
    } else if (blockedPct >= 30) {
      suggestions.push({
        id: `blocked-${m.id}`,
        severity: 'warning',
        title: `${MACHINES[m.type].shortName} #${m.id} Blocked ${blockedPct}%`,
        detail: `${MACHINES[m.type].name} #${m.id} at (${m.x}, ${m.z}) output buffer is full ${blockedPct}% of ticks. Add a Storage Crate, branch via Splitter, or connect a Shipping Dock downstream.`,
        targetX: m.x,
        targetZ: m.z,
        machineId: m.id,
      });
    }
  }

  // 5. Congested conveyor lines
  const congestedBelts = entities.filter(
    (e) =>
      MACHINES[e.type].isConveyor &&
      e.totalTicks > 40 &&
      e.blockedTicks / e.totalTicks > 0.4
  );
  if (congestedBelts.length > 0) {
    const b = congestedBelts[0];
    const pct = Math.round((b.blockedTicks / b.totalTicks) * 100);
    suggestions.push({
      id: `belt-cong-${b.id}`,
      severity: 'warning',
      title: `Conveyor Backup (${congestedBelts.length} belt tiles)`,
      detail: `Conveyor #${b.id} at (${b.x}, ${b.z}) is backed up ${pct}% of ticks. Insert a Conveyor Splitter to divert overflow to a parallel Assembler or Shipping Dock.`,
      targetX: b.x,
      targetZ: b.z,
      machineId: b.id,
    });
  }

  // 6. Generator fuel warnings
  const lowFuelGens = entities.filter(
    (e) => e.type === 'generator' && e.fuel < 30
  );
  if (lowFuelGens.length > 0) {
    const g = lowFuelGens[0];
    suggestions.push({
      id: `gen-fuel-${g.id}`,
      severity: 'warning',
      title: `Generator #${g.id} Fuel Low (${Math.round(g.fuel)}%)`,
      detail: `Power Generator #${g.id} at (${g.x}, ${g.z}) has ${Math.round(g.fuel)}% coal fuel remaining. Route an Ore Extractor on a Coal vein with a Robotic Arm into it.`,
      targetX: g.x,
      targetZ: g.z,
      machineId: g.id,
    });
  }

  // 7. Quality Inspector recommendation
  const hasInspector = entities.some((e) => e.type === 'inspector');
  if (!hasInspector) {
    suggestions.push({
      id: 'add-inspector',
      severity: 'info',
      title: 'Add Quality Inspector for Research Points',
      detail:
        'Unlock Laser Metrology (Tier 3) and place a Quality Inspector on your Circuit or Robot Part belt to multiply Research Point generation.',
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      id: 'optimal',
      severity: 'info',
      title: `Production Balanced (${metrics.utilizationPct}% Utilization)`,
      detail:
        'No starvation, power deficit, or belt congestion detected. Expand Circuit and Robot Part assemblers or stamp a saved blueprint to scale throughput.',
    });
  }

  return suggestions.slice(0, 6);
}

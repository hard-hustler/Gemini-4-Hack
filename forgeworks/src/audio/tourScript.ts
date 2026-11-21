import { MachineEntity, SimMetrics } from '../types/factory';

export interface LiveTourNarration {
  stepId: string;
  speakerName: string;
  speakerRole: string;
  text: string;
  estimatedDurationMs: number;
}

function countByType(entities: MachineEntity[], type: MachineEntity['type']): number {
  let n = 0;
  for (let i = 0; i < entities.length; i++) {
    if (entities[i].type === type) n++;
  }
  return n;
}

/**
 * Pure deterministic generator that builds a plain-English, live-data voice script
 * reflecting the user's ACTUAL factory layout, machine counts, throughput, power load, and bottlenecks.
 */
export function buildLiveTourScript(
  stepId: string,
  entities: MachineEntity[],
  metrics: SimMetrics
): LiveTourNarration {
  const totalMachines = entities.length;
  const generators = countByType(entities, 'generator');
  const extractors = countByType(entities, 'extractor');
  const smelters = countByType(entities, 'smelter');
  const assemblers = countByType(entities, 'assembler');
  const inserters = countByType(entities, 'inserter');
  const inspectors = countByType(entities, 'inspector');
  const docks = countByType(entities, 'shipping_dock');
  const brokenCount = entities.filter((e) => e.status === 'broken').length;

  const powerPct = Math.round(metrics.powerSatisfaction * 100);
  const supplyKW = Math.round(metrics.powerSupplyKW);
  const demandKW = Math.round(metrics.powerDemandKW);
  const rates = metrics.productionRates;

  let text = '';

  switch (stepId) {
    case 'power': {
      const statusClause =
        powerPct < 98
          ? `Heads up — your grid is currently in brownout at ${powerPct} percent capacity, so adding another generator will restore full machine speed.`
          : `Right now your grid is rock solid at ${powerPct} percent capacity, keeping every motor on the floor running smoothly.`;
      text =
        `Welcome to Bay One, the Coal Turbine Power Plant. ` +
        `Your factory currently runs ${generators} turbine ${generators === 1 ? 'generator' : 'generators'} producing ${supplyKW} kilowatts against a ${demandKW} kilowatt load. ` +
        `Coal is fed automatically at ${rates.coal} units per minute and routed overhead through steel pylons. ` +
        statusClause;
      break;
    }

    case 'mining': {
      text =
        `Here in Bay Two, you have ${extractors} heavy rotary quarry ${extractors === 1 ? 'drill' : 'drills'} boring directly into underground mineral beds. ` +
        `They are pulling ${rates.iron_ore} Iron Ore and ${rates.copper_ore} Copper Ore per minute onto galvanized roller conveyors, ` +
        `where automated line mergers combine parallel belts into a steady raw-material feed.`;
      break;
    }

    case 'smelting': {
      text =
        `Next is Bay Three, our high-temperature Blast Smelting line. ` +
        `${inserters} articulated robotic arms load raw ore into ${smelters} refractory blast ${smelters === 1 ? 'furnace' : 'furnaces'}, ` +
        `refining ${rates.iron_plate} flat Steel Plates and ${rates.copper_wire} spooled Copper Wires every minute for downstream machining.`;
      break;
    }

    case 'machining': {
      const bottleneckNote =
        metrics.bottleneckMachineId !== null
          ? ` Notice the red ring on the floor: machine number ${metrics.bottleneckMachineId} is currently our main bottleneck, which you can expand anytime in Build Mode.`
          : ` All CNC stations are balanced with clean material flow.`;
      text =
        `Welcome to Bay Four, the CNC Machining and Electronics hall. ` +
        `Your ${assemblers} enclosed five-axis CNC ${assemblers === 1 ? 'center is' : 'centers are'} cutting Steel Plates into ${rates.gear} precision Gears per minute, ` +
        `then pairing Gears with Copper Wire to assemble ${rates.circuit} Logic Circuits per minute.` +
        bottleneckNote;
      break;
    }

    case 'shipping': {
      text =
        `Finally, Bay Five: Robotics Assembly, Laser Inspection, and Export. ` +
        `Your line is turning out ${rates.robot_part} finished Robot Parts per minute, scanning them under ${inspectors} optical laser ${inspectors === 1 ? 'inspector' : 'inspectors'}, ` +
        `and dispatching them through ${docks} loading ${docks === 1 ? 'dock' : 'docks'}. ` +
        `You have shipped ${metrics.totalItemsShipped} finished units so far, bringing your funds to ${metrics.money.toLocaleString()} dollars.`;
      break;
    }

    case 'overview':
    default: {
      const maintClause =
        brokenCount > 0
          ? ` We currently have ${brokenCount} machine under autonomous drone repair.`
          : ` All production bays are online and moving ${metrics.activeItemCount} active parts across the belts.`;
      text =
        `Hello! I am Elena Vance, your Lead Plant Engineer. Welcome to your live FORGEWORKS facility. ` +
        `You currently have ${totalMachines} industrial machines running at ${Math.round(metrics.utilizationPct)} percent utilization and ${powerPct} percent power stability.` +
        maintClause +
        ` Follow me as we walk left to right from power generation all the way to final robotics shipping.`;
      break;
    }
  }

  // Natural speaking pace (~155 words/minute -> ~390ms per word, clamped cleanly)
  const wordCount = text.trim().split(/\s+/).length;
  const estimatedDurationMs = Math.max(
    5500,
    Math.min(18000, Math.round(wordCount * 410 + 1100))
  );

  return {
    stepId,
    speakerName: 'Elena Vance',
    speakerRole: 'Lead Plant Engineer',
    text,
    estimatedDurationMs,
  };
}

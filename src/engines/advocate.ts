// Pure deterministic 5-agent Devil's Advocate inspection engine, A* floor character
// pathing, and rule-validated fallback repair generators.
// Runs identically on browser (live preview) and server (Improve gate + Fixer).

import type {
  AdvocateCharacter,
  AdvocateFinding,
  AdvocateReport,
  AdvocateRole,
  AdvocateSeverity,
  AdvocateVerdict,
  AgentVerdictSummary,
  CharacterRole,
  CharacterWalkPlan,
  Requirements,
} from '../contracts';
import { applyOps, dockPoint, footprint, snap, type EditOp, type FactorySpec, type Point, type Station } from '../spec';
import { accessCells, astar, buildGrid, cellCentre, isFree, pointToCell, stationIndexById, type Cell, type Grid } from './grid';
import type { Routes } from './route';
import { simulate } from './simulate';
import { validate } from './validate';
import type { Metrics } from './versions';

export const ADVOCATE_ROLES: AdvocateRole[] = ['stress', 'safety', 'cfo', 'compliance', 'maintenance'];

export const ADVOCATE_CHARACTERS: Record<CharacterRole, AdvocateCharacter> = {
  stress: {
    role: 'stress',
    name: 'Marcus Cole',
    title: 'Stress & Bottleneck Breaker',
    shortTitle: 'Stress Breaker',
    accent: '#c97b1e',
    suitColor: '#363a42',
    vestColor: '#d98a24',
    hatColor: '#e59a28',
    skinColor: '#8d5d3e',
    prop: 'tablet',
    voice: 'Fenrir',
    style: 'Direct, urgent plant operations engineer speaking clearly on the factory floor',
  },
  safety: {
    role: 'safety',
    name: 'Nadia Okafor',
    title: 'Safety & Floor Flow Auditor',
    shortTitle: 'Safety Auditor',
    accent: '#4f7a28',
    suitColor: '#2d333b',
    vestColor: '#98b836',
    hatColor: '#f3f1e8',
    skinColor: '#6f4630',
    prop: 'clipboard',
    voice: 'Kore',
    style: 'Firm, authoritative EHS safety auditor doing a live floor inspection',
  },
  cfo: {
    role: 'cfo',
    name: 'Victor Chen',
    title: 'CFO & Unit-Economics Critic',
    shortTitle: 'CFO Critic',
    accent: '#3e5c76',
    suitColor: '#415061',
    vestColor: '#2c3745',
    hatColor: '#23272e',
    skinColor: '#dcb697',
    prop: 'ledger',
    voice: 'Charon',
    style: 'Crisp, analytical manufacturing CFO questioning capital spend and unit economics',
  },
  compliance: {
    role: 'compliance',
    name: 'Priya Nair',
    title: 'Brief & Requirements Compliance Checker',
    shortTitle: 'Compliance',
    accent: '#2c4c7e',
    suitColor: '#2b4063',
    vestColor: '#3b5785',
    hatColor: '#1f2329',
    skinColor: '#a67452',
    prop: 'blueprint',
    voice: 'Zephyr',
    style: 'Precise, calm industrial architect checking the floor against client specifications',
  },
  maintenance: {
    role: 'maintenance',
    name: 'Hank Kowalski',
    title: 'Maintenance & Downtime Skeptic',
    shortTitle: 'Maintenance',
    accent: '#a9412e',
    suitColor: '#4c5749',
    vestColor: '#5e6b59',
    hatColor: '#b9412c',
    skinColor: '#dfb497',
    prop: 'wrench',
    voice: 'Puck',
    style: 'Pragmatic, seasoned lead maintenance technician pointing out service traps',
  },
  fixer: {
    role: 'fixer',
    name: 'Elena Vasquez',
    title: 'Surgical Layout Fixer',
    shortTitle: 'Layout Fixer',
    accent: '#df7f2e',
    suitColor: '#323539',
    vestColor: '#df7f2e',
    hatColor: '#f2ece1',
    skinColor: '#c99371',
    prop: 'laser',
    voice: 'Kore',
    style: 'Confident, solution-focused industrial engineer presenting a verified layout fix',
  },
};

const SEVERITY_RANK: Record<AdvocateSeverity, number> = { blocker: 0, warning: 1, advisory: 2 };

function stationCenter(s: Station): Point {
  const f = footprint(s);
  return { x: f.x + f.w / 2, y: f.y + f.d / 2 };
}

function stationLabel(s: Station): string {
  return s.name ? `${s.id} (${s.name})` : `${s.id} (${s.type})`;
}

/** Count how many cardinal sides (N, S, E, W) of a station have at least one free grid cell adjacent. */
export function countAccessibleSides(spec: FactorySpec, grid: Grid, stationIdx: number): { openSides: number; blockedSides: ('N' | 'S' | 'E' | 'W')[] } {
  const s = spec.stations[stationIdx];
  const f = footprint(s);
  const cell = grid.cell;
  const eps = 1e-6;
  const c0 = Math.max(0, Math.floor(f.x / cell + eps));
  const c1 = Math.min(grid.cols - 1, Math.ceil((f.x + f.w) / cell - eps) - 1);
  const r0 = Math.max(0, Math.floor(f.y / cell + eps));
  const r1 = Math.min(grid.rows - 1, Math.ceil((f.y + f.d) / cell - eps) - 1);

  let north = false;
  let south = false;
  let west = false;
  let east = false;

  for (let c = c0; c <= c1; c++) {
    if (isFree(grid, c, r0 - 1)) north = true;
    if (isFree(grid, c, r1 + 1)) south = true;
  }
  for (let r = r0; r <= r1; r++) {
    if (isFree(grid, c0 - 1, r)) west = true;
    if (isFree(grid, c1 + 1, r)) east = true;
  }

  const blockedSides: ('N' | 'S' | 'E' | 'W')[] = [];
  if (!north) blockedSides.push('N');
  if (!south) blockedSides.push('S');
  if (!west) blockedSides.push('W');
  if (!east) blockedSides.push('E');
  return { openSides: 4 - blockedSides.length, blockedSides };
}

/** Check whether a station has a narrow gap (> 0 and < minGap) to any of the four outer walls. */
export function wallPinches(spec: FactorySpec, s: Station, minGap = 1.2): { wall: 'N' | 'S' | 'W' | 'E'; gap: number }[] {
  const f = footprint(s);
  const gaps: { wall: 'N' | 'S' | 'W' | 'E'; gap: number }[] = [
    { wall: 'W', gap: f.x },
    { wall: 'N', gap: f.y },
    { wall: 'E', gap: spec.floor.width - (f.x + f.w) },
    { wall: 'S', gap: spec.floor.depth - (f.y + f.d) },
  ];
  return gaps.filter((g) => g.gap > 0.02 && g.gap < minGap - 0.02);
}

/** Deterministic 5-agent adversarial audit grounded in simulation, surge testing, geometry, and routing. */
export function runDeterministicAdvocateAudit(
  spec: FactorySpec,
  metrics: Metrics,
  routes: Routes,
  requirements?: Requirements,
): AdvocateReport {
  const t0 = Date.now();
  const findings: AdvocateFinding[] = [];
  const grid = buildGrid(spec);
  const sim = metrics.sim;
  const cost = metrics.cost;

  const stationsByType = new Map<string, Station[]>();
  for (const s of spec.stations) {
    const arr = stationsByType.get(s.type) ?? [];
    arr.push(s);
    stationsByType.set(s.type, arr);
  }

  // ---- 1. MARCUS COLE: Stress & Bottleneck Breaker ----
  const baseUph = sim.unitsPerHour.median;
  const demand = spec.demandPerHour;
  if (baseUph < demand * 0.97) {
    const hotType = sim.bottleneck.name;
    const hotIds = hotType === 'forklift' ? spec.stations.slice(0, 2).map((s) => s.id) : (stationsByType.get(hotType) ?? []).map((s) => s.id);
    const shortfall = Math.max(0.1, demand - baseUph);
    findings.push({
      id: 'stress-demand-shortfall',
      role: 'stress',
      severity: 'blocker',
      title: `Throughput misses demand by ${shortfall.toFixed(1)} units/hr`,
      evidence: `Median output is ${baseUph.toFixed(1)} units/hr against a ${demand} units/hr target; ${hotType} is pegged at ${Math.round(sim.bottleneck.utilisation * 100)}%.`,
      metricDeltaHint: `+${shortfall.toFixed(1)} units/hr needed`,
      targetIds: hotIds,
      suggestedFixHint: hotType === 'forklift' ? 'Add a second forklift or tighten consecutive step spacing.' : `Add a parallel ${hotType} station to split queue load.`,
      spokenLine: `This line misses target by ${shortfall.toFixed(1)} units an hour. ${hotType === 'forklift' ? 'The forklift loop is choked' : `${hotType} is maxed out at ${Math.round(sim.bottleneck.utilisation * 100)} percent`}, so we need capacity relief before launch.`,
      source: 'deterministic',
    });
  }

  // Real +20% demand surge stress simulation
  const surgeDemand = Math.round(demand * 1.2);
  const surgeSim = simulate({ ...spec, demandPerHour: surgeDemand }, { seeds: 12, routes });
  const surgeRatio = surgeSim.unitsPerHour.median / Math.max(1, surgeDemand);
  const leadSpike = surgeSim.leadTimeSec.median / Math.max(1, sim.leadTimeSec.median);
  if (surgeRatio < 0.92 || leadSpike >= 1.45) {
    const surgeHot = surgeSim.bottleneck.name;
    const surgeIds = surgeHot === 'forklift' ? spec.stations.slice(0, 2).map((s) => s.id) : (stationsByType.get(surgeHot) ?? []).map((s) => s.id);
    const severity: AdvocateSeverity = surgeRatio < 0.84 || leadSpike >= 1.85 ? 'blocker' : 'warning';
    findings.push({
      id: 'stress-surge-20',
      role: 'stress',
      severity,
      title: `+20% demand surge collapses on ${surgeHot}`,
      evidence: `At ${surgeDemand} units/hr, output stalls at ${surgeSim.unitsPerHour.median.toFixed(1)} units/hr (${Math.round(surgeSim.bottleneck.utilisation * 100)}% util) and lead time jumps ${leadSpike.toFixed(2)}× to ${(surgeSim.leadTimeSec.median / 60).toFixed(1)} min.`,
      metricDeltaHint: `${(surgeSim.leadTimeSec.median / 60).toFixed(1)} min under +20% load`,
      targetIds: surgeIds,
      suggestedFixHint: surgeHot === 'forklift' ? 'Shorten forklift travel legs or add a carrier for surge headroom.' : `Add a parallel ${surgeHot} unit or shorten travel into ${surgeHot}.`,
      spokenLine: `I ran a twenty percent surge test at ${surgeDemand} units an hour and ${surgeHot} cracked immediately. Lead time jumped to ${(surgeSim.leadTimeSec.median / 60).toFixed(1)} minutes with zero surge headroom.`,
      source: 'deterministic',
    });
  }

  // Forklift saturation check
  const forkUtil = sim.utilisation.forklift ?? 0;
  if (forkUtil >= 0.78) {
    const farIds = [...spec.stations]
      .sort((a, b) => {
        const da = Math.hypot(a.x - spec.floor.width / 2, a.y - spec.floor.depth / 2);
        const db = Math.hypot(b.x - spec.floor.width / 2, b.y - spec.floor.depth / 2);
        return db - da;
      })
      .slice(0, 2)
      .map((s) => s.id);
    findings.push({
      id: 'stress-forklift-sat',
      role: 'stress',
      severity: forkUtil >= 0.9 ? 'blocker' : 'warning',
      title: `Forklift fleet saturated at ${Math.round(forkUtil * 100)}%`,
      evidence: `${spec.forklifts ?? 1} carrier${(spec.forklifts ?? 1) > 1 ? 's' : ''} haul ${routes.totals.forkliftM.toFixed(0)} m per unit (${cost.forkliftMPerHour.toFixed(0)} m/hr), risking downstream starvation.`,
      metricDeltaHint: `${routes.totals.forkliftM.toFixed(0)} m forklift loop`,
      targetIds: farIds,
      suggestedFixHint: 'Pack sequential stations along one straight spine or add 1 forklift.',
      spokenLine: `Your forklift loop is running ${Math.round(forkUtil * 100)} percent busy across ${routes.totals.forkliftM.toFixed(0)} metres per unit. Tighten the spine or add a second carrier before stations starve.`,
      source: 'deterministic',
    });
  }

  // ---- 2. NADIA OKAFOR: Safety & Floor Flow Auditor ----
  // Outer-wall pinch check (Dry Run's validate() checks station-to-station aisles, not narrow dead gaps against outer walls)
  const pinched: { s: Station; wall: string; gap: number }[] = [];
  for (const s of spec.stations) {
    const ps = wallPinches(spec, s, 1.2);
    if (ps.length) pinched.push({ s, wall: ps[0].wall, gap: ps[0].gap });
  }
  if (pinched.length) {
    const worst = pinched.sort((a, b) => a.gap - b.gap)[0];
    const severity: AdvocateSeverity = worst.gap <= 0.65 ? 'blocker' : 'warning';
    findings.push({
      id: `safety-wall-pinch-${worst.s.id}`,
      role: 'safety',
      severity,
      title: `Wall pinch trap behind ${worst.s.id} (${worst.gap.toFixed(1)} m)`,
      evidence: `${pinched.map((p) => `${p.s.id} sits ${p.gap.toFixed(1)} m off the ${p.wall} wall`).slice(0, 3).join('; ')}. Sub-1.2 m perimeter gaps trap operators and block forklift escape clearance.`,
      metricDeltaHint: `Needs 0 m flush or >= 1.5 m clear`,
      targetIds: pinched.slice(0, 3).map((p) => p.s.id),
      suggestedFixHint: `Either seat ${worst.s.id} flush against the ${worst.wall} wall (0 m) or pull it inward to at least 1.5 m clearance.`,
      spokenLine: `Standing right by ${worst.s.id}, there is a ${worst.gap.toFixed(1)} metre pinch gap against the ${worst.wall} wall. Seat it flush to the perimeter or pull it out to one and a half metres for safe egress.`,
      source: 'deterministic',
    });
  }

  // Forklift corridor choke cells (shared cell traversed by >= 3 legs)
  const cellTraffic = new Map<string, Set<number>>();
  for (const legPath of routes.forklift) {
    for (const p of legPath.points) {
      const c = pointToCell(grid, p);
      const key = `${c.c},${c.r}`;
      const set = cellTraffic.get(key) ?? new Set<number>();
      set.add(legPath.leg);
      cellTraffic.set(key, set);
    }
  }
  const chokeCells = [...cellTraffic.entries()].filter(([, legs]) => legs.size >= 3);
  if (chokeCells.length >= 2) {
    // Find nearest station to busiest choke cell
    const [busiestKey, busiestLegs] = chokeCells.sort((a, b) => b[1].size - a[1].size)[0];
    const [cc, cr] = busiestKey.split(',').map(Number);
    const chokePt = cellCentre(grid, cc, cr);
    const nearest = [...spec.stations].sort((a, b) => {
      const ca = stationCenter(a);
      const cb = stationCenter(b);
      return Math.hypot(ca.x - chokePt.x, ca.y - chokePt.y) - Math.hypot(cb.x - chokePt.x, cb.y - chokePt.y);
    })[0];
    findings.push({
      id: 'safety-corridor-choke',
      role: 'safety',
      severity: busiestLegs.size >= 4 ? 'warning' : 'advisory',
      title: `Forklift crossing choke near ${nearest?.id ?? 'center aisle'}`,
      evidence: `${chokeCells.length} aisle cells carry 3+ overlapping transport legs (peak ${busiestLegs.size} legs crossing at x=${chokePt.x.toFixed(1)}, y=${chokePt.y.toFixed(1)}), creating head-on collision risk.`,
      metricDeltaHint: `${chokeCells.length} congested aisle cells`,
      targetIds: nearest ? [nearest.id] : [],
      suggestedFixHint: 'Unroll process stations in left-to-right or U-flow sequence so transport legs do not double back across the same aisle.',
      spokenLine: `${busiestLegs.size} separate forklift legs cross right beside ${nearest?.id ?? 'the central aisle'}. Unroll the flow into a clean one-way spine so carriers stop cutting across each other.`,
      source: 'deterministic',
    });
  }

  // Long exposed utility runs
  const longPower = [...routes.power].sort((a, b) => b.length - a.length)[0];
  const longWater = [...routes.water].sort((a, b) => b.length - a.length)[0];
  const totalUtilM = routes.totals.powerM + routes.totals.waterM;
  if ((longWater && longWater.length >= 18) || (longPower && longPower.length >= 24) || totalUtilM >= 85) {
    const worstRun =
      longWater && longWater.length >= 18
        ? { kind: 'water' as const, ...longWater }
        : longPower
          ? { kind: 'power' as const, ...longPower }
          : null;
    if (worstRun) {
      findings.push({
        id: `safety-utility-run-${worstRun.id}`,
        role: 'safety',
        severity: worstRun.length >= 26 ? 'warning' : 'advisory',
        title: `Long ${worstRun.kind} run to ${worstRun.id} (${worstRun.length.toFixed(0)} m)`,
        evidence: `${worstRun.id} pulls ${worstRun.length.toFixed(1)} m of ${worstRun.kind} line across active aisles; total utility routing is ${totalUtilM.toFixed(0)} m ($${cost.utilityRunCost.toFixed(0)}).`,
        metricDeltaHint: `Saves up to $${Math.round(worstRun.length * (worstRun.kind === 'water' ? 85 : 55))} in runs`,
        targetIds: [worstRun.id],
        suggestedFixHint: `Shift ${worstRun.id} closer to the ${worstRun.kind} entry point at (${spec.utilityEntry[worstRun.kind].x}, ${spec.utilityEntry[worstRun.kind].y}).`,
        spokenLine: `We are running ${worstRun.length.toFixed(0)} metres of ${worstRun.kind} piping across the floor just to reach ${worstRun.id}. Move it closer to the ${worstRun.kind} entry wall to cut hazard and install cost.`,
        source: 'deterministic',
      });
    }
  }

  // ---- 3. VICTOR CHEN: CFO & Unit-Economics Critic ----
  for (const [type, list] of stationsByType.entries()) {
    const u = sim.utilisation[type] ?? 0;
    if (list.length > 1 && u < 0.34) {
      const capex = list[list.length - 1].price;
      const last = list[list.length - 1];
      findings.push({
        id: `cfo-idle-capex-${last.id}`,
        role: 'cfo',
        severity: u < 0.22 ? 'warning' : 'advisory',
        title: `Under-utilized ${type} CapEx (${Math.round(u * 100)}% across ${list.length} units)`,
        evidence: `${list.length} ${type} units run at only ${Math.round(u * 100)}% average load; retiring ${last.id} could reclaim $${capex.toLocaleString()} CapEx and operator wages.`,
        metricDeltaHint: `Up to -$${capex.toLocaleString()} build cost`,
        targetIds: [last.id],
        suggestedFixHint: `Test removing ${last.id} if a single unit still clears demand with margin.`,
        spokenLine: `We bought ${list.length} ${type} stations and they are idling at ${Math.round(u * 100)} percent. Dropping ${last.id} saves ${capex.toLocaleString()} dollars in CapEx right off the build.`,
        source: 'deterministic',
      });
      break;
    }
  }

  const forklifts = spec.forklifts ?? 1;
  if (forklifts > 1 && forkUtil < 0.3) {
    findings.push({
      id: 'cfo-excess-forklift',
      role: 'cfo',
      severity: 'warning',
      title: `Excess forklift fleet (${forklifts} carriers at ${Math.round(forkUtil * 100)}% util)`,
      evidence: `Each extra carrier adds $${spec.costs.labourPerHour}/hr operator & fleet cost while utilization sits below 30%.`,
      metricDeltaHint: `-$${spec.costs.labourPerHour}/hr opex`,
      targetIds: spec.stations.slice(0, 1).map((s) => s.id),
      suggestedFixHint: `Reduce forklifts from ${forklifts} to ${forklifts - 1}.`,
      spokenLine: `We are paying for ${forklifts} forklifts when utilization is only ${Math.round(forkUtil * 100)} percent. Cut one carrier and drop our hourly burn immediately.`,
      source: 'deterministic',
    });
  }

  const utilShare = cost.utilityRunCost / Math.max(1, cost.buildCost);
  if (utilShare >= 0.30 || routes.totals.forkliftM >= 42) {
    const target = longWater?.id ?? longPower?.id ?? spec.stations[0]?.id;
    findings.push({
      id: 'cfo-run-economics',
      role: 'cfo',
      severity: utilShare >= 0.34 ? 'warning' : 'advisory',
      title: `Layout inefficiency inflates build & transport cost`,
      evidence: `Utility runs consume ${Math.round(utilShare * 100)}% ($${cost.utilityRunCost.toFixed(0)}) of total $${cost.buildCost.toFixed(0)} build cost, and forklift travel is ${routes.totals.forkliftM.toFixed(0)} m/unit ($${cost.costPerUnit.toFixed(2)}/unit).`,
      metricDeltaHint: `$${cost.costPerUnit.toFixed(2)}/unit · $${cost.utilityRunCost.toFixed(0)} utility runs`,
      targetIds: target ? [target] : [],
      suggestedFixHint: 'Cluster power/water machines near utility entries and tighten dock-to-dock sequence.',
      spokenLine: `At ${cost.costPerUnit.toFixed(2)} dollars a unit, ${Math.round(utilShare * 100)} percent of our build budget is going into bare copper and plumbing runs. Pull the heavy machines closer to the utilities.`,
      source: 'deterministic',
    });
  }

  // ---- 4. PRIYA NAIR: Brief & Requirements Compliance Checker ----
  if (requirements) {
    const reqTypes = new Set(requirements.steps.map((st) => st.type));
    const specTypes = new Set(spec.stations.map((s) => s.type));
    const missingTypes = [...reqTypes].filter((t) => !specTypes.has(t));
    if (missingTypes.length) {
      findings.push({
        id: 'compliance-missing-steps',
        role: 'compliance',
        severity: 'blocker',
        title: `Missing required process step: ${missingTypes.join(', ')}`,
        evidence: `The client brief requires ${requirements.steps.map((s) => s.type).join(' -> ')}, but the floor omits ${missingTypes.join(', ')}.`,
        metricDeltaHint: `${missingTypes.length} missing step(s)`,
        targetIds: spec.stations.slice(0, 1).map((s) => s.id),
        suggestedFixHint: `Restore stations for ${missingTypes.join(', ')} and include them in routing.`,
        spokenLine: `Hold on — this layout drops ${missingTypes.join(' and ')} from the client brief. We cannot sign off until every mandated process step is back on the floor.`,
        source: 'deterministic',
      });
    }
    if (Math.abs(spec.demandPerHour - requirements.demandPerHour) > 0.5) {
      findings.push({
        id: 'compliance-demand-drift',
        role: 'compliance',
        severity: 'warning',
        title: `Demand drifted from brief (${spec.demandPerHour} vs ${requirements.demandPerHour}/hr)`,
        evidence: `Client specification calls for ${requirements.demandPerHour} units/hr, while the simulation is currently set to ${spec.demandPerHour} units/hr.`,
        metricDeltaHint: `Target ${requirements.demandPerHour} units/hr`,
        targetIds: spec.stations.slice(-1).map((s) => s.id),
        suggestedFixHint: `Reset demandPerHour to ${requirements.demandPerHour}.`,
        spokenLine: `Your demand slider is at ${spec.demandPerHour} units an hour, but the signed brief requires ${requirements.demandPerHour}. Let us test against the real contract target.`,
        source: 'deterministic',
      });
    }
  }

  // Flow backtracking check (does material double back across the floor from Receiving to Shipping?)
  if (spec.docks.length >= 2 && spec.routing.length >= 3) {
    const dockIn = dockPoint(spec, spec.docks[0]);
    const dockOut = dockPoint(spec, spec.docks[1]);
    const dirX = dockOut.x - dockIn.x;
    const dirY = dockOut.y - dockIn.y;
    const axisLen = Math.hypot(dirX, dirY);
    if (axisLen > 4) {
      const stageProj = spec.routing.map((type) => {
        const list = stationsByType.get(type) ?? [];
        if (!list.length) return { type, proj: 0, ids: [] as string[] };
        const avgX = list.reduce((t, s) => t + stationCenter(s).x, 0) / list.length;
        const avgY = list.reduce((t, s) => t + stationCenter(s).y, 0) / list.length;
        const proj = ((avgX - dockIn.x) * dirX + (avgY - dockIn.y) * dirY) / axisLen;
        return { type, proj, ids: list.map((s) => s.id) };
      });
      let worstBacktrack = 0;
      let culprit: { from: string; to: string; ids: string[] } | null = null;
      for (let i = 1; i < stageProj.length; i++) {
        const back = stageProj[i - 1].proj - stageProj[i].proj;
        if (back > worstBacktrack) {
          worstBacktrack = back;
          culprit = { from: stageProj[i - 1].type, to: stageProj[i].type, ids: stageProj[i].ids };
        }
      }
      if (culprit && worstBacktrack >= 3.5) {
        findings.push({
          id: `compliance-flow-backtrack-${culprit.to}`,
          role: 'compliance',
          severity: worstBacktrack >= 7 ? 'warning' : 'advisory',
          title: `Process flow backtracks ${worstBacktrack.toFixed(1)} m into ${culprit.to}`,
          evidence: `Material travels ${worstBacktrack.toFixed(1)} m backwards against the Receiving-to-Shipping axis between ${culprit.from} and ${culprit.to}.`,
          metricDeltaHint: `-${Math.round(worstBacktrack * 2)} m shorter flow`,
          targetIds: culprit.ids,
          suggestedFixHint: `Reposition ${culprit.ids.join(', ')} downstream of ${culprit.from} along the dock-to-dock spine.`,
          spokenLine: `Check the blueprint order: material moves backward ${worstBacktrack.toFixed(0)} metres going from ${culprit.from} to ${culprit.to}. Align ${culprit.ids[0]} downstream toward shipping.`,
          source: 'deterministic',
        });
      }
    }
  }

  // ---- 5. HANK KOWALSKI: Maintenance & Downtime Skeptic ----
  const boxedStations: { s: Station; openSides: number; blocked: string[] }[] = [];
  spec.stations.forEach((s, i) => {
    const { openSides, blockedSides } = countAccessibleSides(spec, grid, i);
    if (openSides <= 1 && (s.powerKw > 0 || s.needsWater || s.type !== 'storage')) {
      boxedStations.push({ s, openSides, blocked: blockedSides });
    }
  });
  if (boxedStations.length) {
    const worst = boxedStations.sort((a, b) => a.openSides - b.openSides)[0];
    findings.push({
      id: `maintenance-boxed-${worst.s.id}`,
      role: 'maintenance',
      severity: worst.openSides === 0 ? 'blocker' : 'warning',
      title: `Zero rear/side service access on ${worst.s.id}`,
      evidence: `${stationLabel(worst.s)} is blocked on ${worst.blocked.join(', ')} (${worst.openSides}/4 sides open). Technicians cannot pull panels or service drives without moving adjacent equipment.`,
      metricDeltaHint: `Open >= 2 service sides`,
      targetIds: boxedStations.slice(0, 2).map((b) => b.s.id),
      suggestedFixHint: `Shift ${worst.s.id} off the corner or separate it by 1.5 m from neighboring cabinets.`,
      spokenLine: `Look at ${worst.s.id}: it is boxed in on ${worst.blocked.length} sides. When a servo drive blows, my crew has to unbolt the machine next door just to get a wrench behind it.`,
      source: 'deterministic',
    });
  }

  // Single-point-of-failure critical machine (zero redundancy)
  const spofStages = [...stationsByType.entries()]
    .map(([type, list]) => ({ type, list, util: sim.utilisation[type] ?? 0 }))
    .filter((x) => x.list.length === 1 && x.util >= 0.62)
    .sort((a, b) => b.util - a.util);
  if (spofStages.length) {
    const top = spofStages[0];
    const st = top.list[0];
    findings.push({
      id: `maintenance-spof-${st.id}`,
      role: 'maintenance',
      severity: top.util >= 0.84 ? 'blocker' : 'warning',
      title: `Zero redundancy on ${st.id} (${Math.round(top.util * 100)}% load)`,
      evidence: `${stationLabel(st)} is the sole ${top.type} unit handling ${Math.round(top.util * 100)}% utilization; any unplanned stop halts 100% of downstream output with no bypass.`,
      metricDeltaHint: `100% line stoppage risk`,
      targetIds: [st.id],
      suggestedFixHint: `Add a second ${top.type} unit to share load and survive preventative maintenance windows.`,
      spokenLine: `If ${st.id} throws a fault during shift, the entire plant stops dead. It is running ${Math.round(top.util * 100)} percent load with zero backup unit on the floor.`,
      source: 'deterministic',
    });
  }

  // Sort findings by severity (blocker -> warning -> advisory) then role order
  findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || ADVOCATE_ROLES.indexOf(a.role) - ADVOCATE_ROLES.indexOf(b.role));

  const blockerCount = findings.filter((f) => f.severity === 'blocker').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;
  const advisoryCount = findings.filter((f) => f.severity === 'advisory').length;
  const verdict: AdvocateVerdict = blockerCount > 0 ? 'veto' : warningCount > 0 ? 'warn' : 'pass';

  const agentVerdicts: AgentVerdictSummary[] = ADVOCATE_ROLES.map((role) => {
    const mine = findings.filter((f) => f.role === role);
    const blockers = mine.filter((f) => f.severity === 'blocker').length;
    const warnings = mine.filter((f) => f.severity === 'warning').length;
    const v: AdvocateVerdict = blockers > 0 ? 'veto' : warnings > 0 ? 'warn' : 'pass';
    const note = mine.length ? mine[0].title : 'No material defects flagged on this floor.';
    return { role, verdict: v, findingCount: mine.length, blockerCount: blockers, note };
  });

  const walkPlans = computeCharacterWalkPlans(spec, findings);
  const summary =
    blockerCount > 0
      ? `${blockerCount} blocking objection${blockerCount > 1 ? 's' : ''} and ${warningCount} warning${warningCount === 1 ? '' : 's'} across 5 inspectors.`
      : warningCount > 0
        ? `No hard blockers, but ${warningCount} warning${warningCount === 1 ? '' : 's'} need attention before build.`
        : 'All 5 devil’s advocate inspectors cleared this layout.';

  return {
    verdict,
    summary,
    blockerCount,
    warningCount,
    advisoryCount,
    findings,
    agentVerdicts,
    walkPlans,
    ms: Date.now() - t0,
    mode: 'deterministic',
  };
}

/** Find a clean free perimeter starting cell for each role so characters enter from distinct aisle points. */
function pickStartCell(grid: Grid, roleIndex: number, used: Set<string>): Cell {
  const candidates: Cell[] = [];
  const anchors: [number, number][] = [
    [1, 1],
    [grid.cols - 2, 1],
    [1, grid.rows - 2],
    [grid.cols - 2, grid.rows - 2],
    [Math.floor(grid.cols / 2), 1],
    [Math.floor(grid.cols / 2), grid.rows - 2],
  ];
  const [ac, ar] = anchors[roleIndex % anchors.length];
  for (let rad = 0; rad <= Math.max(grid.cols, grid.rows); rad++) {
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        if (Math.abs(dc) !== rad && Math.abs(dr) !== rad) continue;
        const c = ac + dc;
        const r = ar + dr;
        const key = `${c},${r}`;
        if (isFree(grid, c, r) && !used.has(key)) {
          used.add(key);
          return { c, r };
        }
      }
    }
  }
  candidates.push({ c: 0, r: 0 });
  return candidates[0];
}

/**
 * Compute obstacle-free A* walking routes across free floor cells for all 5 Devil's Advocate characters
 * (and optionally Elena Vasquez, the Surgical Fixer) so each walks directly to their inspected station
 * and stops at a distinct, unobstructed standing cell facing the machine.
 */
export function computeCharacterWalkPlans(
  spec: FactorySpec,
  findings: AdvocateFinding[],
  fixerTargetIds?: string[],
): CharacterWalkPlan[] {
  const grid = buildGrid(spec);
  const usedStarts = new Set<string>();
  const usedStands = new Set<string>();
  const plans: CharacterWalkPlan[] = [];

  const roles: CharacterRole[] = fixerTargetIds && fixerTargetIds.length > 0 ? [...ADVOCATE_ROLES, 'fixer'] : [...ADVOCATE_ROLES];

  roles.forEach((role, idx) => {
    const roleFindings = role === 'fixer' ? [] : findings.filter((f) => f.role === role);
    const primary = roleFindings[0] ?? null;
    const explicitTargetId = role === 'fixer' ? fixerTargetIds?.[0] ?? null : primary?.targetIds[0] ?? null;

    // Pick a fallback station when an agent has 0 findings so they still patrol a meaningful zone
    const fallbackStation = spec.stations[idx % Math.max(1, spec.stations.length)] ?? null;
    const targetStation = (explicitTargetId ? spec.stations.find((s) => s.id === explicitTargetId) : null) ?? fallbackStation;
    const stIndex = targetStation ? stationIndexById(spec, targetStation.id) : -1;

    const startCell = pickStartCell(grid, idx, usedStarts);
    const goalCellsAll = stIndex >= 0 ? accessCells(grid, stIndex) : [];
    const unusedGoals = goalCellsAll.filter((g) => !usedStands.has(`${g.c},${g.r}`));
    const goalCells = unusedGoals.length ? unusedGoals : goalCellsAll;

    let cellPath: Cell[] | null = goalCells.length ? astar(grid, [startCell], goalCells) : null;
    if (!cellPath && goalCells.length) {
      cellPath = [goalCells[0]];
    }
    if (!cellPath || !cellPath.length) {
      cellPath = [startCell];
    }

    const standCell = cellPath[cellPath.length - 1];
    usedStands.add(`${standCell.c},${standCell.r}`);

    // Simplify colinear intermediate cells to keep smooth polylines
    const rawPoints = cellPath.map((c) => cellCentre(grid, c.c, c.r));
    const path: Point[] = [];
    for (let i = 0; i < rawPoints.length; i++) {
      const prev = path[path.length - 1];
      const cur = rawPoints[i];
      const next = rawPoints[i + 1];
      if (prev && next) {
        const sameX = Math.abs(prev.x - cur.x) < 1e-6 && Math.abs(cur.x - next.x) < 1e-6;
        const sameY = Math.abs(prev.y - cur.y) < 1e-6 && Math.abs(cur.y - next.y) < 1e-6;
        if (sameX || sameY) continue;
      }
      path.push(cur);
    }

    const standPoint = path[path.length - 1] ?? cellCentre(grid, startCell.c, startCell.r);
    const lookAtPoint = targetStation ? stationCenter(targetStation) : { x: spec.floor.width / 2, y: spec.floor.depth / 2 };

    plans.push({
      role,
      targetId: targetStation?.id ?? null,
      targetLabel: targetStation ? targetStation.name ?? targetStation.id : 'Floor center',
      standPoint,
      lookAtPoint,
      path,
      findingIds: roleFindings.map((f) => f.id),
      primaryFindingId: primary?.id ?? null,
    });
  });

  return plans;
}

/** Find a valid open floor coordinate for a station of dimensions (w, d) near a preferred anchor point. */
function findValidPlacement(spec: FactorySpec, candidateStation: Station, near: Point): Point | null {
  const cell = spec.floor.cellSize;
  const f = footprint(candidateStation);
  const maxX = Math.max(0, spec.floor.width - f.w);
  const maxY = Math.max(0, spec.floor.depth - f.d);
  const spots: { x: number; y: number; dist: number }[] = [];
  for (let x = 0; x <= maxX + 1e-6; x += cell) {
    for (let y = 0; y <= maxY + 1e-6; y += cell) {
      const sx = snap(x, cell);
      const sy = snap(y, cell);
      // Avoid creating a new sub-1.2m wall pinch!
      const testStation = { ...candidateStation, x: sx, y: sy };
      if (wallPinches(spec, testStation, 1.2).length > 0) continue;
      spots.push({ x: sx, y: sy, dist: Math.hypot(sx - near.x, sy - near.y) });
    }
  }
  spots.sort((a, b) => a.dist - b.dist);
  for (const spot of spots.slice(0, 120)) {
    const exists = spec.stations.some((s) => s.id === candidateStation.id);
    const op: EditOp = exists
      ? { op: 'move', id: candidateStation.id, x: spot.x, y: spot.y }
      : { op: 'add', station: { ...candidateStation, x: spot.x, y: spot.y } };
    const next = applyOps(spec, [op]);
    if (validate(next).length === 0) return { x: spot.x, y: spot.y };
  }
  return null;
}

export interface DeterministicFixCandidate {
  label: string;
  ops: EditOp[];
  spec: FactorySpec;
}

/**
 * Build deterministic, rule-validated repair op sequences targeting the selected findings.
 * Competes alongside Gemini 4 Neon's surgical proposals so the Fixer always delivers a legal patch.
 */
export function buildDeterministicFixCandidates(spec: FactorySpec, findings: AdvocateFinding[]): DeterministicFixCandidate[] {
  const candidates: DeterministicFixCandidate[] = [];
  const combinedOps: EditOp[] = [];
  let working = structuredClone(spec);

  const tryStep = (label: string, ops: EditOp[]) => {
    try {
      const next = applyOps(working, ops);
      if (validate(next).length === 0) {
        candidates.push({ label, ops, spec: next });
        working = next;
        combinedOps.push(...ops);
        return true;
      }
    } catch {
      /* skip illegal move */
    }
    return false;
  };

  for (const f of findings) {
    // 1. Fix wall pinch traps by seating flush (0) or pulling inward >= 1.5m
    if (f.id.startsWith('safety-wall-pinch-')) {
      for (const id of f.targetIds) {
        const st = working.stations.find((s) => s.id === id);
        if (!st) continue;
        const fp = footprint(st);
        const pinches = wallPinches(working, st, 1.2);
        if (!pinches.length) continue;
        const p = pinches[0];
        const attempts: Point[] = [];
        if (p.wall === 'W') attempts.push({ x: 0, y: st.y }, { x: 1.5, y: st.y });
        if (p.wall === 'N') attempts.push({ x: st.x, y: 0 }, { x: st.x, y: 1.5 });
        if (p.wall === 'E') attempts.push({ x: snap(working.floor.width - fp.w, working.floor.cellSize), y: st.y }, { x: snap(working.floor.width - fp.w - 1.5, working.floor.cellSize), y: st.y });
        if (p.wall === 'S') attempts.push({ x: st.x, y: snap(working.floor.depth - fp.d, working.floor.cellSize) }, { x: st.x, y: snap(working.floor.depth - fp.d - 1.5, working.floor.cellSize) });
        let fixed = false;
        for (const pt of attempts) {
          if (tryStep(`Eliminate wall pinch on ${st.id}`, [{ op: 'move', id: st.id, x: pt.x, y: pt.y }])) {
            fixed = true;
            break;
          }
        }
        if (!fixed) {
          const spot = findValidPlacement(working, st, { x: working.floor.width / 2, y: working.floor.depth / 2 });
          if (spot) tryStep(`Reposition ${st.id} clear of wall`, [{ op: 'move', id: st.id, x: spot.x, y: spot.y }]);
        }
      }
    }

    // 2. Fix single-point bottlenecks / demand shortfall / +20% surge by adding a parallel station or forklift
    if (f.id === 'stress-demand-shortfall' || f.id === 'stress-surge-20' || f.id.startsWith('maintenance-spof-')) {
      if (f.title.toLowerCase().includes('forklift')) {
        const nextForks = Math.min(4, (working.forklifts ?? 1) + 1);
        if (nextForks > (working.forklifts ?? 1)) {
          tryStep('Add second forklift for surge relief', [{ op: 'setParam', path: 'forklifts', value: nextForks }]);
        }
      } else {
        const target = working.stations.find((s) => f.targetIds.includes(s.id));
        if (target) {
          const existingNums = working.stations
            .filter((s) => s.type === target.type)
            .map((s) => Number(/\d+$/.exec(s.id)?.[0] ?? 1));
          const nextNum = Math.max(1, ...existingNums) + 1;
          const prefix = target.id.replace(/\d+$/, '') || target.type;
          const newId = `${prefix}${nextNum}`;
          const clone: Station = { ...structuredClone(target), id: newId };
          const spot = findValidPlacement(working, clone, { x: target.x + 2, y: target.y });
          if (spot) {
            tryStep(`Add parallel ${target.type} unit (${newId})`, [{ op: 'add', station: { ...clone, x: spot.x, y: spot.y } }]);
          }
        }
      }
    }

    // 3. Fix forklift saturation
    if (f.id === 'stress-forklift-sat') {
      const nextForks = Math.min(4, (working.forklifts ?? 1) + 1);
      if (nextForks > (working.forklifts ?? 1)) {
        tryStep('Add forklift carrier to relieve transport saturation', [{ op: 'setParam', path: 'forklifts', value: nextForks }]);
      }
    }

    // 4. Fix excess idle forklift
    if (f.id === 'cfo-excess-forklift' && (working.forklifts ?? 1) > 1) {
      tryStep('Trim excess idle forklift', [{ op: 'setParam', path: 'forklifts', value: (working.forklifts ?? 1) - 1 }]);
    }

    // 5. Fix long utility run by pulling station toward its utility entry
    if (f.id.startsWith('safety-utility-run-') || f.id === 'cfo-run-economics') {
      const target = working.stations.find((s) => f.targetIds.includes(s.id));
      if (target) {
        const anchor = target.needsWater ? working.utilityEntry.water : working.utilityEntry.power;
        const spot = findValidPlacement(working, target, anchor);
        if (spot && (spot.x !== target.x || spot.y !== target.y)) {
          tryStep(`Move ${target.id} closer to utility entry`, [{ op: 'move', id: target.id, x: spot.x, y: spot.y }]);
        }
      }
    }

    // 6. Fix boxed-in station with zero service access
    if (f.id.startsWith('maintenance-boxed-')) {
      const target = working.stations.find((s) => f.targetIds.includes(s.id));
      if (target) {
        const spot = findValidPlacement(working, target, { x: working.floor.width / 2, y: working.floor.depth / 2 });
        if (spot && (spot.x !== target.x || spot.y !== target.y)) {
          tryStep(`Open maintenance envelope around ${target.id}`, [{ op: 'move', id: target.id, x: spot.x, y: spot.y }]);
        }
      }
    }
  }

  if (combinedOps.length > 1) {
    try {
      const allNext = applyOps(spec, combinedOps);
      if (validate(allNext).length === 0) {
        candidates.unshift({ label: `Combined ${combinedOps.length}-op fix`, ops: combinedOps, spec: allNext });
      }
    } catch {
      /* individual candidates remain available */
    }
  }

  return candidates;
}

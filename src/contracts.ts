// Shared contracts between the three workstreams.
//   harness  (this repo's server/harness.ts): brief -> Requirements -> EquipmentLine[] -> FactorySpec
//   catalog  (machines and how they look):    CatalogItem, modelUrl
//   shopify  (search and buying flow):        ShopListing -> CatalogItem via /api/catalog/convert
// Everything that crosses a boundary is one of these types. Change them here, nowhere else.

import type { FeatureKind, MachineRecipe } from './machines';
import type { MachineModel } from './model3d';
import type { EditOp, FactorySpec, Point, Wall } from './spec';

/** One buyable or built-in piece of equipment. The catalog team owns the look (modelUrl, colour). */
export interface CatalogItem {
  id: string;
  name: string;
  /** the process role it can fill, e.g. storage, prep, assembly, test, pack */
  stationType: string;
  /** metres */
  footprint: { w: number; d: number; h: number };
  cycleTimeSec: number;
  operators: number;
  powerKw: number;
  needsWater: boolean;
  price: number;
  source: 'builtin' | 'shopify';
  /** present when the item came from a Shopify listing */
  listing?: ShopListing;
  /** GLB produced by the listing -> 3D converter; the scene falls back to a procedural model without it */
  modelUrl?: string;
  /** a free-form detailed model designed by a sculptor agent; drawn in preference to the recipe */
  model?: MachineModel;
  /** how the model fared in inspection */
  modelChecks?: ModelChecks;
  /** how the machine is built: an archetype plus features. The scene draws this. */
  recipe?: MachineRecipe;
  /** how the recipe was arrived at, when it was read from a listing */
  recipeChecks?: RecipeChecks;
  /** legacy hint, only used when there is no recipe */
  shape?: 'bench' | 'rack' | 'machine' | 'table' | 'conveyor';
  /** 0..1 from the Decisions API when specs were read off a listing */
  confidence?: number;
  /** procurement add-on: where the footprint came from when it is a Shop item (stated in the listing, or checked by the user) */
  sizeSource?: 'listing' | 'user';
}

/** Provenance of an agent-built model: what the inspector made of its render. */
export interface ModelChecks {
  /** 0..1 Decisions API: how well the render represents the listing photo */
  likeness: number;
  coherent: number;
  proportions: number;
  accepted: boolean;
  /** render-inspect-correct rounds taken */
  rounds: number;
  parts: number;
  sawPhoto: boolean;
  dimsStated: boolean;
  /** how well the listing suits the step, from the scout's ranking */
  fit: number;
}

/** Provenance of a recipe read from a listing: what the independent check made of it. */
export interface RecipeChecks {
  /** did the listing photo reach the models, or was this read from text alone */
  sawPhoto: boolean;
  /** Decisions API: probability the product really is this archetype */
  archetype: number;
  /** each feature the recipe kept, with the probability the checker saw it */
  features: { kind: FeatureKind; seen: number }[];
  /** features the designer claimed that the checker did not see, or that could not be built */
  dropped: { kind: FeatureKind; why: string }[];
  /** true only when the listing states the dimensions used */
  dimsStated: boolean;
  /** designer attempts before the recipe passed the code checks */
  attempts: number;
}

/** What the Shopify side hands over for one search result. */
export interface ShopListing {
  title: string;
  seller: string;
  price: number;
  currency: string;
  url: string;
  checkoutUrl?: string;
  image?: string;
  variantId: string;
  rating?: number;
  /** footprint read from the listing text, when it states one */
  dims?: { w: number; d: number; text: string };
  /** plain-text description, trimmed; used to read specs */
  description?: string;
  /** exact Shop ids, kept as returned for a later checkout (procurement add-on) */
  productId?: string;
  sellerDomain?: string;
}

/** One step of the process, in order. The model decides this; it never decides coordinates. */
export interface ProcessStep {
  type: string;
  label: string;
  /** the equipment that does the step, named as a buyer would search for it: "CNC lathe", not "CNC turning" */
  machine?: string;
  count: number;
  cycleTimeSec: number;
  operators: number;
  powerKw: number;
  needsWater: boolean;
  /** rough footprint in metres, used only when the catalog has nothing for this type */
  w: number;
  d: number;
  /** the department this step belongs to, on plants with several */
  zone?: string;
}

export interface Requirements {
  name: string;
  summary: string;
  floor: { width: number; depth: number };
  demandPerHour: number;
  steps: ProcessStep[];
  dockIn: Wall;
  dockOut: Wall;
  powerWall: Wall;
  waterWall: Wall;
  /** conveyors on lines and plants, forklifts in workshops */
  transport?: 'forklift' | 'conveyor';
  /** how big the harness judged the brief to be; a plant's equipment is designed, anything smaller is sourced from Shop first */
  scale?: 'workshop' | 'line' | 'plant';
  /** what the research phase found, when one ran */
  research?: { summary: string; sources: { url: string; title: string }[]; queries: string[] };
  /** only when the brief includes a drawing: where each drawn station sits, as fractions of the floor */
  sketch: { type: string; fx: number; fy: number }[];
  assumptions: string[];
}

/** One row of the bill of equipment: which catalog item fills which step, and how many. */
export interface EquipmentLine {
  stepType: string;
  label: string;
  /** what to search a marketplace for when sourcing this step */
  machine?: string;
  qty: number;
  item: CatalogItem;
  /** Decisions API: probability that the brief really asks for this step */
  inBrief?: number;
}

/** One thing the harness did. The UI shows these as the run tracker; they are also the audit log. */
export interface TraceEvent {
  stage: 'read' | 'research' | 'plan' | 'check' | 'equip' | 'place' | 'simulate' | 'improve' | 'convert' | 'advocate' | 'fix';
  actor: 'hydrogen' | 'neon' | 'decisions' | 'agent' | 'engine' | 'shop' | 'advocate' | 'fixer';
  title: string;
  detail?: string;
  ms: number;
  /** 'running' is only ever streamed: it says what is in flight and is replaced by the next event */
  status: 'ok' | 'retry' | 'fail' | 'running';
}

export type Emit = (e: TraceEvent) => void;

export interface PlanResult {
  requirements: Requirements;
  equipment: EquipmentLine[];
  /** 0..1 Decisions API score: how completely the plan covers the brief */
  coverage?: number;
  trace: TraceEvent[];
}

// ---- Devil's Advocate Review, Surgical Fixer, and 3D Floor Crew ----

export type AdvocateRole = 'stress' | 'safety' | 'cfo' | 'compliance' | 'maintenance';
export type CharacterRole = AdvocateRole | 'fixer';
export type AdvocateSeverity = 'blocker' | 'warning' | 'advisory';
export type AdvocateVerdict = 'pass' | 'warn' | 'veto';
export type AdvocateVoice = 'Fenrir' | 'Kore' | 'Charon' | 'Zephyr' | 'Puck';

export interface AdvocateCharacter {
  role: CharacterRole;
  name: string;
  title: string;
  shortTitle: string;
  accent: string;
  suitColor: string;
  vestColor: string;
  hatColor: string;
  skinColor: string;
  prop: 'tablet' | 'clipboard' | 'ledger' | 'blueprint' | 'wrench' | 'laser';
  voice: AdvocateVoice;
  style: string;
}

export interface AdvocateFinding {
  id: string;
  role: AdvocateRole;
  severity: AdvocateSeverity;
  title: string;
  evidence: string;
  metricDeltaHint: string;
  targetIds: string[];
  suggestedFixHint: string;
  /** First-person critique delivered aloud by the 3D floor character */
  spokenLine: string;
  /** Calibrated risk probability from Gemini Decisions API when full audit runs */
  decisionConfidence?: number;
  source: 'deterministic' | 'gemini';
}

export interface CharacterWalkPlan {
  role: CharacterRole;
  targetId: string | null;
  targetLabel: string;
  standPoint: Point;
  lookAtPoint: Point;
  /** Obstacle-free A* floor waypoints in floor metres [0..width, 0..depth] */
  path: Point[];
  findingIds: string[];
  primaryFindingId: string | null;
}

export interface AgentVerdictSummary {
  role: AdvocateRole;
  verdict: AdvocateVerdict;
  findingCount: number;
  blockerCount: number;
  decisionScore?: number;
  note: string;
}

export interface AdvocateReport {
  verdict: AdvocateVerdict;
  summary: string;
  blockerCount: number;
  warningCount: number;
  advisoryCount: number;
  findings: AdvocateFinding[];
  agentVerdicts: AgentVerdictSummary[];
  walkPlans: CharacterWalkPlan[];
  ms: number;
  mode: 'deterministic' | 'full';
}

export interface MetricDeltas {
  uph: number;
  leadMin: number;
  costPerUnit: number;
  buildCost: number;
}

export interface FixProposal {
  id: string;
  targetFindingIds: string[];
  summary: string;
  spokenSummary: string;
  ops: EditOp[];
  spec: FactorySpec;
  deltas: MetricDeltas;
  resolvedCount: number;
  remainingBlockers: number;
  remainingWarnings: number;
  postAudit: AdvocateReport;
  source: 'neon' | 'deterministic';
  ms: number;
}

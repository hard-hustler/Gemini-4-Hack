// Shared contracts between the three workstreams.
//   harness  (this repo's server/harness.ts): brief -> Requirements -> EquipmentLine[] -> FactorySpec
//   catalog  (machines and how they look):    CatalogItem, modelUrl
//   shopify  (search and buying flow):        ShopListing -> CatalogItem via /api/catalog/convert
// Everything that crosses a boundary is one of these types. Change them here, nowhere else.

import type { FeatureKind, MachineRecipe } from './machines';
import type { MachineModel } from './model3d';
import type { Wall } from './spec';

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
}

/** One step of the process, in order. The model decides this; it never decides coordinates. */
export interface ProcessStep {
  type: string;
  label: string;
  count: number;
  cycleTimeSec: number;
  operators: number;
  powerKw: number;
  needsWater: boolean;
  /** rough footprint in metres, used only when the catalog has nothing for this type */
  w: number;
  d: number;
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
  /** only when the brief includes a drawing: where each drawn station sits, as fractions of the floor */
  sketch: { type: string; fx: number; fy: number }[];
  assumptions: string[];
}

/** One row of the bill of equipment: which catalog item fills which step, and how many. */
export interface EquipmentLine {
  stepType: string;
  label: string;
  qty: number;
  item: CatalogItem;
  /** Decisions API: probability that the brief really asks for this step */
  inBrief?: number;
}

/** One thing the harness did. The UI shows these as the run tracker; they are also the audit log. */
export interface TraceEvent {
  stage: 'read' | 'plan' | 'check' | 'equip' | 'place' | 'simulate' | 'improve' | 'convert';
  actor: 'hydrogen' | 'neon' | 'decisions' | 'agent' | 'engine' | 'shop';
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

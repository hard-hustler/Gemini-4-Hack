// Procurement add-on (from the StudioForge procurement module), built on Dry Run's own types.
//   budget      an equipment budget on the project, checked against the plan and the bill of equipment
//   size check  a Shop listing whose size was estimated, not stated, is checked by the user before it is used
//   export      the layout as a `studioforge.procurement.snapshot` (schema 1.0) for the later checkout step
//   drop-in     a Shop item dragged straight onto a layout, placed by the same rules as every other edit
// Pure functions only, unit tested in procurement.test.ts. Units are the app's (dollars, metres);
// only the export converts prices to integer cents, as the snapshot contract asks.

import type { CatalogItem, EquipmentLine, ShopListing } from './contracts';
import { gapBetween, validate, type ValidationError } from './engines/validate';
import { applyOp, footprint, gridSize, snap, type FactorySpec, type Point, type Rot, type Station } from './spec';

const cents = (dollars: number) => Math.round(dollars * 100);
const round2 = (v: number) => Math.round(v * 100) / 100;
/** Listing titles run long; keep the app's 60-character names but end on a whole word. */
const shortName = (title: string) => (title.length <= 60 ? title : `${title.slice(0, 59).replace(/\s+\S*$/, '')}…`);

// ---- Budget ----

export interface BudgetStatus {
  budget: number;
  spend: number;
  /** budget minus spend; negative when over */
  left: number;
  over: boolean;
  /** 0..1 share of the budget used, capped, for the meter */
  used: number;
}

/** Spend against the budget, compared in whole cents. Null when no budget is set. */
export function budgetStatus(spend: number, budget: number | undefined): BudgetStatus | null {
  if (budget === undefined || !Number.isFinite(budget) || budget <= 0) return null;
  return {
    budget,
    spend,
    left: (cents(budget) - cents(spend)) / 100,
    over: cents(spend) > cents(budget),
    used: Math.min(1, Math.max(0, spend / budget)),
  };
}

/** Change in plan spend if this listing replaced the line's item, for every unit on the line. */
export function swapDelta(line: EquipmentLine, listing: Pick<ShopListing, 'price'>): number {
  return line.qty * (listing.price - line.item.price);
}

// ---- Size check ----

export interface Size {
  w: number;
  d: number;
  h: number;
}

/** Same bounds the server applies when it reads specs off a listing. */
export const SIZE_MIN = 0.2;
export const SIZE_MAX = 12;

export function sizeError(s: Size): string | null {
  for (const [label, v] of [
    ['Width', s.w],
    ['Depth', s.d],
    ['Height', s.h],
  ] as const) {
    if (!Number.isFinite(v) || v < SIZE_MIN || v > SIZE_MAX) return `${label} must be between ${SIZE_MIN} and ${SIZE_MAX} m`;
  }
  return null;
}

export const formatSize = (s: Size) => `${round2(s.w)} × ${round2(s.d)} × ${round2(s.h)} m`;

/** The converted item with the size the user checked. The recipe's envelope follows, since the scene draws from it. */
export function withSize(item: CatalogItem, size: Size): CatalogItem {
  const s = { w: round2(size.w), d: round2(size.d), h: round2(size.h) };
  const r = item.recipe;
  return {
    ...item,
    footprint: s,
    ...(r ? { recipe: { ...r, size: s, workHeight: r.workHeight !== undefined ? Math.min(r.workHeight, s.h) : undefined } } : {}),
    sizeSource: 'user',
  };
}

/**
 * Fallback when the listing cannot be read automatically (no model key, model error):
 * the size comes from the user, and the process numbers stay those of the line's current item.
 */
export function itemFromListing(listing: ShopListing, line: EquipmentLine, size: Size): CatalogItem {
  const base = line.item;
  return {
    id: `shop-${listing.variantId.split('/').pop()}`,
    name: shortName(listing.title),
    stationType: line.stepType,
    footprint: { w: round2(size.w), d: round2(size.d), h: round2(size.h) },
    cycleTimeSec: base.cycleTimeSec,
    operators: base.operators,
    powerKw: base.powerKw,
    needsWater: base.needsWater,
    price: listing.price,
    source: 'shopify',
    listing: { ...listing, description: undefined },
    shape: base.shape,
    sizeSource: 'user',
  };
}

// ---- Drop-in: a Shop item placed straight onto a layout ----

/** Next free id for a station of this type, in the placer's style: assembly3 after assembly1 and assembly2. */
export function nextStationId(spec: FactorySpec, type: string): string {
  const used = new Set(spec.stations.map((s) => s.id));
  let n = spec.stations.filter((s) => s.type === type).length + 1;
  while (used.has(`${type}${n}`)) n++;
  return `${type}${n}`;
}

/** A station for a catalog item, built the way the placer builds one (src/engines/place.ts): same grid sizing, same fields. */
export function stationFromItem(item: CatalogItem, id: string, cell: number): Station {
  const grid = (v: number) => gridSize(v, cell);
  return {
    id,
    type: item.stationType,
    x: 0,
    y: 0,
    w: grid(item.footprint.w),
    d: grid(item.footprint.d),
    rot: 0,
    cycleTimeSec: Math.max(1, item.cycleTimeSec),
    operators: item.operators,
    powerKw: item.powerKw,
    needsWater: item.needsWater,
    price: item.price,
    name: item.name,
    catalogId: item.id,
    height: item.recipe?.size.h ?? item.footprint.h,
    shape: item.shape,
    recipe: item.recipe,
    modelUrl: item.modelUrl,
    image: item.listing?.image,
    listingUrl: item.listing?.url,
    checkoutUrl: item.listing?.checkoutUrl,
  };
}

/** The station centred on a point (as far as the grid allows), at a quarter turn or not. */
export function stationAt(station: Station, centre: Point, rot: Rot, cell: number): Station {
  const turned = rot === 90 || rot === 270;
  const w = turned ? station.d : station.w;
  const d = turned ? station.w : station.d;
  return { ...station, rot, x: snap(centre.x - w / 2, cell), y: snap(centre.y - d / 2, cell) };
}

export type Placement = { spec: FactorySpec; station: Station; moved: boolean } | { errors: ValidationError[] };

/**
 * Add a station as close as it can go to where it was dropped: the drop point itself if the layout still passes
 * every rule (validate), else the nearest grid position, or quarter turn, within `radius` metres that does, else
 * the nearest valid spot anywhere on the floor. Nothing valid at all: the rule errors at the drop point, so the
 * user sees why.
 */
export function placeNear(spec: FactorySpec, station: Station, target: Point, radius = 4): Placement {
  const first = stationAt(station, target, 0, spec.floor.cellSize);
  const found = searchNear(spec, station, target, radius, first) ?? searchNear(spec, station, target, Math.hypot(spec.floor.width, spec.floor.depth), first);
  return found ?? { errors: validate(applyOp(spec, { op: 'add', station: first })) };
}

function searchNear(spec: FactorySpec, station: Station, target: Point, radius: number, first: Station): Exclude<Placement, { errors: ValidationError[] }> | null {
  const cell = spec.floor.cellSize;
  const taken = spec.stations.map(footprint);
  const steps = Math.round(radius / cell);
  const candidates: { s: Station; dist: number }[] = [];
  for (let i = -steps; i <= steps; i++) {
    for (let j = -steps; j <= steps; j++) {
      const dist = Math.hypot(i * cell, j * cell);
      if (dist > radius + 1e-9) continue;
      for (const rot of [0, 90] as Rot[]) candidates.push({ s: stationAt(station, { x: target.x + i * cell, y: target.y + j * cell }, rot, cell), dist: dist + (rot ? 0.01 : 0) });
    }
  }
  candidates.sort((a, b) => a.dist - b.dist);
  const seen = new Set<string>();
  for (const { s } of candidates) {
    const key = `${s.x},${s.y},${s.rot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const f = footprint(s);
    if (f.x < 0 || f.y < 0 || f.x + f.w > spec.floor.width + 1e-9 || f.y + f.d > spec.floor.depth + 1e-9) continue;
    // cheap first: skip spots already taken before running every rule
    if (taken.some((t) => gapBetween(t, f).overlap)) continue;
    const next = applyOp(spec, { op: 'add', station: s });
    if (validate(next).length === 0) return { spec: next, station: s, moved: s.x !== first.x || s.y !== first.y || s.rot !== first.rot };
  }
  return null;
}

// ---- Export: studioforge.procurement.snapshot ----

export const SNAPSHOT_KIND = 'studioforge.procurement.snapshot';
export const SNAPSHOT_VERSION = '1.0';

export interface SnapshotEquipment {
  instance_id: string;
  title: string;
  station_type: string;
  /** Dry Run has no owned-equipment concept yet, so nothing is a fixture */
  fixture: false;
  product: {
    /** exact Shop ids when the station's item came from Shop; null otherwise, never made up */
    id: string | null;
    variant_id: string | null;
    seller_domain: string | null;
    /** 'demo' marks built-in catalog items: placeholders, never purchasable */
    source: 'shopify-live' | 'demo';
    price_cents: number;
    currency: string;
    url: string | null;
    checkout_url: string | null;
  };
  /** the product's own size, turned to match the placement */
  dimensions_m: { width: number; depth: number; height: number | null };
  /** the box the layout reserves for it: the size snapped to the floor grid */
  grid_footprint_m: { width: number; depth: number };
  /** north-west corner of the grid footprint; x runs east, y runs south */
  placement: { x_m: number; y_m: number; rotation_deg: number };
  dimension_source: string;
}

export interface ProcurementSnapshot {
  schema_version: typeof SNAPSHOT_VERSION;
  kind: typeof SNAPSHOT_KIND;
  layout: { name: string | null; version: string | null };
  /** Dry Run models docks on walls rather than a door zone, so door is null and docks are listed */
  room: { width_m: number; depth_m: number; door: null; docks: { wall: string; offset_m: number; kind: string | null }[] };
  budget: { currency: 'USD'; cap_cents: number | null; committed_cents: number };
  equipment: SnapshotEquipment[];
}

function dimensionSource(item: CatalogItem | undefined): string {
  if (!item) return 'unknown';
  if (item.source === 'builtin') return 'built-in catalog';
  if (item.sizeSource === 'user') return 'user-verified';
  if (item.sizeSource === 'listing') return 'stated in the listing — verify variant';
  return 'read from the listing by the model — verify';
}

/**
 * The layout's equipment with the identifiers a checkout needs. Stations are matched by catalogId to the plan's
 * items and to `extra` items (Shop items dropped straight onto a layout); a station whose item is in neither
 * keeps only its own links.
 */
export function procurementSnapshot(spec: FactorySpec, equipment: EquipmentLine[], budget?: number, version?: string, extra: CatalogItem[] = []): ProcurementSnapshot {
  const items = new Map(equipment.map((l) => [l.item.id, l.item] as const));
  for (const it of extra) if (!items.has(it.id)) items.set(it.id, it);
  const rows = spec.stations.map((s): SnapshotEquipment => {
    const item = s.catalogId ? items.get(s.catalogId) : undefined;
    const listing = item?.listing;
    const fromShop = item ? item.source === 'shopify' : Boolean(s.listingUrl || s.checkoutUrl);
    const grid = footprint(s);
    const turned = s.rot === 90 || s.rot === 270;
    const size = item?.footprint ?? { w: s.w, d: s.d, h: s.height ?? NaN };
    return {
      instance_id: s.id,
      title: s.name ?? s.type,
      station_type: s.type,
      fixture: false,
      product: {
        id: listing?.productId ?? null,
        variant_id: listing?.variantId ?? null,
        seller_domain: listing?.sellerDomain ?? null,
        source: fromShop ? 'shopify-live' : 'demo',
        price_cents: cents(s.price),
        currency: listing?.currency ?? 'USD',
        url: listing?.url ?? s.listingUrl ?? null,
        checkout_url: listing?.checkoutUrl ?? s.checkoutUrl ?? null,
      },
      dimensions_m: { width: turned ? size.d : size.w, depth: turned ? size.w : size.d, height: Number.isFinite(size.h) ? size.h : null },
      grid_footprint_m: { width: grid.w, depth: grid.d },
      placement: { x_m: s.x, y_m: s.y, rotation_deg: s.rot },
      dimension_source: dimensionSource(item),
    };
  });
  return {
    schema_version: SNAPSHOT_VERSION,
    kind: SNAPSHOT_KIND,
    layout: { name: spec.name ?? null, version: version ?? null },
    room: { width_m: spec.floor.width, depth_m: spec.floor.depth, door: null, docks: spec.docks.map((d) => ({ wall: d.wall, offset_m: d.offset, kind: d.kind ?? null })) },
    budget: { currency: 'USD', cap_cents: budget && budget > 0 ? cents(budget) : null, committed_cents: rows.reduce((t, r) => t + r.product.price_cents, 0) },
    equipment: rows,
  };
}

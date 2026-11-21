import { describe, expect, it } from 'vitest';
import { BUILTIN } from './catalog';
import type { CatalogItem, EquipmentLine, ShopListing } from './contracts';
import { workshop } from './fixtures/workshop';
import { validate } from './engines/validate';
import { budgetStatus, itemFromListing, nextStationId, placeNear, procurementSnapshot, SNAPSHOT_KIND, sizeError, stationFromItem, swapDelta, withSize } from './procurement';
import { footprint, gridSize, type FactorySpec } from './spec';

const listing: ShopListing = {
  title: 'Steel workbench with pegboard, 48 x 24 in',
  seller: 'Example Supply',
  price: 1299.5,
  currency: 'USD',
  url: 'https://example.myshopify.com/products/bench',
  checkoutUrl: 'https://example.myshopify.com/cart/123:1',
  variantId: 'gid://shopify/ProductVariant/123',
  productId: 'gid://shopify/p/abc',
  sellerDomain: 'example.myshopify.com',
  dims: { w: 1.22, d: 0.61, text: '48 x 24 in' },
  description: 'long text',
};
const bench = BUILTIN.find((c) => c.id === 'bench-asm')!;
const line: EquipmentLine = { stepType: 'assembly', label: 'Assembly', qty: 2, item: bench };

describe('budget', () => {
  it('is off without a positive budget', () => {
    expect(budgetStatus(100, undefined)).toBeNull();
    expect(budgetStatus(100, 0)).toBeNull();
    expect(budgetStatus(100, Number.NaN)).toBeNull();
  });
  it('reports what is left and the share used', () => {
    expect(budgetStatus(3500, 5000)).toEqual({ budget: 5000, spend: 3500, left: 1500, over: false, used: 0.7 });
  });
  it('compares in whole cents', () => {
    expect(budgetStatus(5000, 5000)?.over).toBe(false);
    expect(budgetStatus(0.1 + 0.2, 0.3)?.over).toBe(false);
    const over = budgetStatus(5000.01, 5000)!;
    expect(over.over).toBe(true);
    expect(over.left).toBe(-0.01);
    expect(over.used).toBe(1);
  });
  it('prices a swap for every unit on the line', () => {
    expect(swapDelta(line, { price: 1000 })).toBe(2 * (1000 - bench.price));
    expect(swapDelta({ ...line, qty: 0 }, { price: 1000 })).toBe(0);
  });
});

describe('size check', () => {
  it('accepts sizes inside the server bounds only', () => {
    expect(sizeError({ w: 1.2, d: 0.6, h: 0.85 })).toBeNull();
    expect(sizeError({ w: 0.1, d: 0.6, h: 0.85 })).toMatch(/^Width/);
    expect(sizeError({ w: 1.2, d: Number.NaN, h: 0.85 })).toMatch(/^Depth/);
    expect(sizeError({ w: 1.2, d: 0.6, h: 13 })).toMatch(/^Height/);
  });
  it('withSize replaces the size, in the footprint and the recipe the scene draws, and marks it user-checked', () => {
    const item: CatalogItem = { ...bench, source: 'shopify', listing, confidence: 0.9 };
    const out = withSize(item, { w: 1.234, d: 0.6, h: 0.9 });
    expect(out.footprint).toEqual({ w: 1.23, d: 0.6, h: 0.9 });
    expect(out.recipe?.size).toEqual({ w: 1.23, d: 0.6, h: 0.9 });
    expect(out.recipe?.workHeight ?? 0).toBeLessThanOrEqual(0.9);
    expect(out.sizeSource).toBe('user');
    expect({ ...out, footprint: item.footprint, recipe: item.recipe, sizeSource: undefined }).toEqual({ ...item, sizeSource: undefined });
    expect(withSize({ ...item, recipe: undefined }, { w: 1, d: 1, h: 1 }).recipe).toBeUndefined();
  });
  it('builds an item by hand when the listing cannot be read', () => {
    const item = itemFromListing(listing, line, { w: 1.22, d: 0.61, h: 0.86 });
    expect(item).toMatchObject({
      id: 'shop-123',
      stationType: 'assembly',
      footprint: { w: 1.22, d: 0.61, h: 0.86 },
      cycleTimeSec: bench.cycleTimeSec,
      operators: bench.operators,
      powerKw: bench.powerKw,
      needsWater: bench.needsWater,
      price: 1299.5,
      source: 'shopify',
      shape: bench.shape,
      sizeSource: 'user',
    });
    expect(item.listing?.description).toBeUndefined();
    expect(item.listing?.variantId).toBe(listing.variantId);
    expect(item.name).toBe(listing.title);
  });
  it('shortens long listing titles on a whole word', () => {
    const long = { ...listing, title: 'Vevor Adjustable Workbench 48 x 23.6" Oak Wood Top Heavy-Duty Worktable New' };
    expect(itemFromListing(long, line, { w: 1, d: 1, h: 1 }).name).toBe('Vevor Adjustable Workbench 48 x 23.6" Oak Wood Top…');
  });
});

describe('procurement snapshot', () => {
  const shopItem: CatalogItem = { ...bench, id: 'shop-123', name: 'Steel workbench', source: 'shopify', listing: { ...listing, description: undefined }, footprint: { w: 2.4, d: 0.9, h: 0.85 }, sizeSource: 'user', price: 1299.5 };
  const rack = BUILTIN.find((c) => c.id === 'rack-std')!;
  const equipment: EquipmentLine[] = [
    { stepType: 'storage', label: 'Receiving rack', qty: 1, item: rack },
    { stepType: 'assembly', label: 'Assembly', qty: 1, item: shopItem },
  ];
  const spec: FactorySpec = {
    ...workshop,
    stations: workshop.stations.map((s) =>
      s.id === 'asm1' ? { ...s, catalogId: 'shop-123', name: 'Steel workbench', rot: 90, price: 1299.5, height: 0.85 } : s.id === 'rack1' ? { ...s, catalogId: 'rack-std', name: rack.name } : s,
    ),
  };
  const snap = procurementSnapshot(spec, equipment, 5000, 'v2');
  const row = (id: string) => snap.equipment.find((e) => e.instance_id === id)!;

  it('has the contract header, room and budget in cents', () => {
    expect(snap.kind).toBe(SNAPSHOT_KIND);
    expect(snap.schema_version).toBe('1.0');
    expect(snap.layout).toEqual({ name: workshop.name, version: 'v2' });
    expect(snap.room).toMatchObject({ width_m: 20, depth_m: 14, door: null });
    expect(snap.room.docks).toEqual([
      { wall: 'W', offset_m: 3, kind: 'in' },
      { wall: 'W', offset_m: 11, kind: 'out' },
    ]);
    expect(snap.budget.cap_cents).toBe(500000);
    expect(snap.budget.committed_cents).toBe(snap.equipment.reduce((t, e) => t + e.product.price_cents, 0));
    expect(procurementSnapshot(spec, equipment).budget.cap_cents).toBeNull();
  });
  it('keeps the exact Shop ids and turns the size with the placement', () => {
    expect(row('asm1')).toEqual({
      instance_id: 'asm1',
      title: 'Steel workbench',
      station_type: 'assembly',
      fixture: false,
      product: {
        id: 'gid://shopify/p/abc',
        variant_id: 'gid://shopify/ProductVariant/123',
        seller_domain: 'example.myshopify.com',
        source: 'shopify-live',
        price_cents: 129950,
        currency: 'USD',
        url: listing.url,
        checkout_url: listing.checkoutUrl,
      },
      dimensions_m: { width: 0.9, depth: 2.4, height: 0.85 },
      grid_footprint_m: { width: 1, depth: 2.5 },
      placement: { x_m: 14, y_m: 5, rotation_deg: 90 },
      dimension_source: 'user-verified',
    });
  });
  it('never makes up ids for built-in or unmatched stations', () => {
    expect(row('rack1').product).toMatchObject({ id: null, variant_id: null, seller_domain: null, source: 'demo', price_cents: 45000 });
    expect(row('rack1').dimension_source).toBe('built-in catalog');
    expect(row('prep1').product).toMatchObject({ id: null, variant_id: null, source: 'demo', url: null });
    expect(row('prep1').dimension_source).toBe('unknown');
    expect(row('prep1').dimensions_m.height).toBeNull();
  });
  it('does not change the spec', () => {
    expect(spec.stations.find((s) => s.id === 'asm1')?.rot).toBe(90);
    expect(workshop.stations.find((s) => s.id === 'asm1')?.catalogId).toBeUndefined();
  });
});

describe('drop-in from Shop', () => {
  const shopBench: CatalogItem = { ...bench, id: 'shop-123', name: 'Steel workbench', source: 'shopify', listing: { ...listing, description: undefined }, footprint: { w: 1.22, d: 0.61, h: 0.86 }, recipe: undefined, price: 1299.5 };
  const station = () => stationFromItem(shopBench, nextStationId(workshop, 'assembly'), workshop.floor.cellSize);

  it('names the new station the way the placer does', () => {
    expect(nextStationId(workshop, 'assembly')).toBe('assembly3');
    expect(nextStationId(workshop, 'kitting')).toBe('kitting1');
  });
  it('sizes and fills the station like the placer: footprint rounded up to the grid, price, links, process numbers', () => {
    expect(station()).toMatchObject({ id: 'assembly3', type: 'assembly', w: 1.5, d: 1, rot: 0, height: 0.86, price: 1299.5, catalogId: 'shop-123', name: 'Steel workbench', listingUrl: listing.url, checkoutUrl: listing.checkoutUrl, cycleTimeSec: bench.cycleTimeSec, operators: bench.operators });
  });
  it('keeps a drop point that passes every rule', () => {
    const r = placeNear(workshop, station(), { x: 9, y: 7 });
    if ('errors' in r) throw new Error(r.errors[0]?.message);
    expect(r.moved).toBe(false);
    expect([r.station.x, r.station.y, r.station.rot]).toEqual([8.5, 6.5, 0]);
    expect(validate(r.spec)).toEqual([]);
    expect(r.spec.stations).toHaveLength(workshop.stations.length + 1);
  });
  it('moves a drop on top of another station to the nearest spot that passes every rule', () => {
    const asm1 = workshop.stations.find((s) => s.id === 'asm1')!;
    const target = { x: asm1.x + 1, y: asm1.y + 0.5 };
    const r = placeNear(workshop, station(), target);
    if ('errors' in r) throw new Error(r.errors[0]?.message);
    expect(r.moved).toBe(true);
    expect(validate(r.spec)).toEqual([]);
    const f = footprint(r.station);
    expect(Math.hypot(f.x + f.w / 2 - target.x, f.y + f.d / 2 - target.y)).toBeLessThanOrEqual(4.5);
  });
  it('reserves at least the size the recipe states (the body the scene draws), never less', () => {
    for (const v of [0.3, 0.5, 0.59, 0.74, 1, 1.22, 1.73, 2.5, 3]) {
      expect(gridSize(v, 0.5)).toBeGreaterThanOrEqual(v);
      expect(gridSize(v, 0.5)).toBeLessThan(Math.max(v, 0.5) + 0.5);
    }
    // the shelving that stacked up in the user's layout: 1.73 x 0.59 m used to get 1.5 x 0.5 m
    const shelf = stationFromItem({ ...shopBench, footprint: { w: 1.73, d: 0.59, h: 1.83 } }, 'storage2', 0.5);
    expect([shelf.w, shelf.d]).toEqual([2, 1]);
  });
  it('looks across the whole floor when nothing near the drop fits', () => {
    const asm1 = workshop.stations.find((s) => s.id === 'asm1')!;
    const r = placeNear(workshop, station(), { x: asm1.x + 1, y: asm1.y + 0.5 }, 0);
    if ('errors' in r) throw new Error(r.errors[0]?.message);
    expect(r.moved).toBe(true);
    expect(validate(r.spec)).toEqual([]);
  });
  it('reports why, quickly, when there is no room anywhere on the floor', () => {
    const big = stationFromItem({ ...shopBench, footprint: { w: 13, d: 13, h: 1 } }, 'assembly3', 0.5);
    const t0 = performance.now();
    const r = placeNear(workshop, big, { x: 10, y: 7 });
    const ms = performance.now() - t0;
    expect('errors' in r && r.errors.some((e) => e.code === 'overlap')).toBe(true);
    expect(ms).toBeLessThan(1500);
  });
  it('says why when nothing nearby is valid', () => {
    const huge = stationFromItem({ ...shopBench, footprint: { w: 30, d: 30, h: 1 } }, 'assembly3', 0.5);
    const r = placeNear(workshop, huge, { x: 10, y: 7 });
    expect('errors' in r && r.errors.some((e) => e.code === 'out_of_bounds')).toBe(true);
  });
  it('exports a dropped item with its exact Shop ids', () => {
    const r = placeNear(workshop, station(), { x: 9, y: 7 });
    if ('errors' in r) throw new Error('no spot');
    const out = procurementSnapshot(r.spec, [], undefined, undefined, [shopBench]);
    expect(out.equipment.find((e) => e.instance_id === 'assembly3')?.product).toMatchObject({ id: 'gid://shopify/p/abc', variant_id: listing.variantId, seller_domain: 'example.myshopify.com', source: 'shopify-live', price_cents: 129950 });
  });
});

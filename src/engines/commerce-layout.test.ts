import { expect, test } from 'vitest';
import { pickItem } from '../catalog';
import type { ProcessStep, Requirements, ShopListing } from '../contracts';
import { leanSpec } from '../spec';
import { buildLayout, cloneStation } from './place';
import { evaluate, makeVersion } from './versions';

test('Shop provenance survives equipment, placement, cloning and versions without entering model prompts', () => {
  const step: ProcessStep = { type: 'assembly', label: 'Assembly', count: 1, cycleTimeSec: 60, operators: 1, powerKw: 0, needsWater: false, w: 2, d: 1 };
  const req: Requirements = { name: 'Commerce seam', summary: 'One bench', floor: { width: 18, depth: 12 }, demandPerHour: 10, steps: [step], dockIn: 'W', dockOut: 'E', powerWall: 'N', waterWall: 'S', sketch: [], assumptions: [] };
  const listing: ShopListing = {
    title: 'Merchant bench', seller: 'Merchant', sellerDomain: 'merchant.myshopify.com', productId: 'product-1', variantId: 'variant-1', variantTitle: 'Steel / 48 inch',
    price: 123.45, priceMinor: 12345, currency: 'USD', available: true,
    url: 'https://merchant.example/products/bench?variant=1&source=shop', image: 'https://cdn.shopify.com/bench.jpg',
  };
  const item = { ...pickItem(step), source: 'shopify' as const, listing, price: listing.price };
  const { spec } = buildLayout(req, [{ stepType: step.type, label: step.label, qty: 1, item }], { polish: false });
  expect(spec.stations[0].listing).toEqual(listing);
  expect(cloneStation(spec, spec.stations[0].id)?.listing).toEqual(listing);
  const ev = evaluate(spec, 2);
  expect(ev.ok).toBe(true);
  if (!ev.ok) throw new Error('Fixture should place');
  const version = makeVersion(spec, ev.metrics, null, 1, 'Listed equipment');
  expect(version.spec.stations[0].listing).toEqual(listing);
  expect(JSON.stringify(leanSpec(spec))).not.toContain('merchant.myshopify.com');
  expect(JSON.stringify(leanSpec(spec))).not.toContain('source=shop');
});

import { describe, expect, it } from 'vitest';
import type { ShopListing } from './contracts';
import { addCartLine, canPurchase, cartFingerprint, cartKey, formatPrice, groupCart, priceSubtotals, safeWebUrl, updateCartQuantity } from './commerce';

const item = (patch: Partial<ShopListing> = {}): ShopListing => ({ title: 'Workbench', seller: 'Merchant', price: 100.99, priceMinor: 10099, currency: 'USD', variantId: 'gid://shopify/ProductVariant/42', sellerDomain: 'merchant.myshopify.com', available: true, url: 'https://merchant.example/products/workbench', ...patch });

describe('commerce cart', () => {
  it('requires confirmed availability, authoritative minor price and merchant identity', () => {
    for (const patch of [{ available: null }, { available: false }, { priceMinor: undefined }, { sellerDomain: undefined }, { variantId: 'concept-42' }]) {
      expect(canPurchase(item(patch))).toBe(false);
      expect(addCartLine([], item(patch))).toEqual([]);
    }
  });
  it('merges exact merchant and variant identities, limits quantities, and removes explicitly', () => {
    const listing = item();
    const lines = addCartLine(addCartLine([], listing, 2), listing, 3);
    expect(lines[0].quantity).toBe(5);
    expect(addCartLine(lines, listing, 1000)[0].quantity).toBe(20);
    expect(updateCartQuantity(lines, cartKey(listing), 0)).toEqual([]);
    expect(updateCartQuantity(lines, cartKey(listing), -1)).toEqual(lines);
  });
  it('never combines merchants or currencies into a single checkout or floating point subtotal', () => {
    const lines = [
      { listing: item(), quantity: 3 },
      { listing: item({ variantId: 'gid://shopify/ProductVariant/43' }), quantity: 2 },
      { listing: item({ sellerDomain: 'other.myshopify.com' }), quantity: 1 },
      { listing: item({ currency: 'CAD' }), quantity: 1 },
    ];
    const groups = groupCart(lines);
    expect(groups).toHaveLength(3);
    expect(groups[0].subtotalMinor).toBe(50495);
    expect(groups[0].lines).toHaveLength(2);
  });
  it('changes approval fingerprints when quantity, price or availability changes', () => {
    const initial = [{ listing: item(), quantity: 1 }];
    expect(cartFingerprint(initial)).not.toBe(cartFingerprint([{ listing: item(), quantity: 2 }]));
    expect(cartFingerprint(initial)).not.toBe(cartFingerprint([{ listing: item({ priceMinor: 10500 }), quantity: 1 }]));
    expect(cartFingerprint(initial)).not.toBe(cartFingerprint([{ listing: item({ available: false }), quantity: 1 }]));
  });
  it('keeps equipment bill currencies separate and identifies built-in planning estimates', () => {
    const totals = priceSubtotals([
      { listing: item(), price: 100.99, quantity: 2 },
      { listing: item({ currency: 'CAD', priceMinor: 25000 }), price: 250, quantity: 3 },
      { price: 40, quantity: 1 },
    ]);
    expect(totals).toEqual([
      { currency: 'USD', priceMinor: 24198, estimated: true },
      { currency: 'CAD', priceMinor: 75000, estimated: false },
    ]);
  });
  it('shows exact cents and currency, and rejects non-HTTPS catalog URLs', () => {
    expect(canPurchase(item({ sellerDomain: 'merchant.example.com' }))).toBe(true);
    expect(canPurchase(item({ sellerDomain: 'https://merchant.example.com' }))).toBe(false);
    expect(formatPrice(item())).toBe('USD 100.99');
    expect(formatPrice(item(), 3)).toBe('USD 302.97');
    expect(safeWebUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeWebUrl('http://merchant.example')).toBeUndefined();
    expect(safeWebUrl('https://user:pass@merchant.example')).toBeUndefined();
    expect(safeWebUrl(item().url)).toBe(item().url);
  });
});

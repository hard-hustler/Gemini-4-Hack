import type { ShopListing } from './contracts';

export interface CartLine {
  listing: ShopListing;
  quantity: number;
}

export const MAX_CART_QUANTITY = 20;

/** Legacy and concept listings stay useful for planning, but cannot enter checkout. */
export function canPurchase(listing: ShopListing): boolean {
  return listing.available === true
    && /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(listing.variantId)
    && /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(listing.sellerDomain ?? '')
    && Number.isSafeInteger(listing.priceMinor) && listing.priceMinor! >= 0
    && /^[A-Z]{3}$/.test(listing.currency);
}

export function cartKey(listing: ShopListing): string {
  return `${listing.sellerDomain?.toLowerCase()}|${listing.currency}|${listing.variantId}`;
}

export function addCartLine(lines: CartLine[], listing: ShopListing, quantity = 1): CartLine[] {
  if (!canPurchase(listing) || !Number.isInteger(quantity) || quantity < 1) return lines;
  const key = cartKey(listing);
  const existing = lines.find((line) => cartKey(line.listing) === key);
  if (!existing) return [...lines, { listing, quantity: Math.min(MAX_CART_QUANTITY, quantity) }];
  return lines.map((line) => cartKey(line.listing) === key
    ? { listing, quantity: Math.min(MAX_CART_QUANTITY, line.quantity + quantity) }
    : line);
}

export function updateCartQuantity(lines: CartLine[], key: string, quantity: number): CartLine[] {
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_CART_QUANTITY) return lines;
  return quantity === 0 ? lines.filter((line) => cartKey(line.listing) !== key)
    : lines.map((line) => cartKey(line.listing) === key ? { ...line, quantity } : line);
}

export function groupCart(lines: CartLine[]) {
  const groups = new Map<string, { key: string; shop: string; seller: string; currency: string; lines: CartLine[]; subtotalMinor: number }>();
  for (const line of lines) {
    const shop = line.listing.sellerDomain?.toLowerCase() ?? '';
    const key = `${shop}|${line.listing.currency}`;
    const group = groups.get(key) ?? { key, shop, seller: line.listing.seller, currency: line.listing.currency, lines: [], subtotalMinor: 0 };
    group.lines.push(line);
    group.subtotalMinor += (line.listing.priceMinor ?? 0) * line.quantity;
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Changes to any approved purchasing detail require another review and request ID. */
export function cartFingerprint(lines: CartLine[]): string {
  return JSON.stringify(lines.map(({ listing, quantity }) => [cartKey(listing), quantity, listing.priceMinor, listing.available, listing.title, listing.seller, listing.variantTitle, listing.options, listing.messages]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function currencyDigits(currency: string): number {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2; }
  catch { return 2; }
}

export function formatPrice(listing: Pick<ShopListing, 'price' | 'priceMinor' | 'currency'>, quantity = 1): string {
  const digits = currencyDigits(listing.currency);
  const amount = listing.priceMinor !== undefined ? listing.priceMinor / 10 ** digits : listing.price;
  return `${listing.currency} ${Number.isFinite(amount) ? (amount * quantity).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }) : 'unavailable'}`;
}

/** Merchant currencies are never added together or silently converted for an equipment bill. */
export function priceSubtotals(lines: { listing?: ShopListing; price: number; quantity: number }[]) {
  const totals = new Map<string, { currency: string; priceMinor: number; estimated: boolean }>();
  for (const { listing, price, quantity } of lines) {
    if (quantity === 0) continue;
    const currency = listing?.currency ?? 'USD';
    const amount = listing?.priceMinor ?? Math.round((listing?.price ?? price) * 10 ** currencyDigits(currency));
    const subtotal = totals.get(currency) ?? { currency, priceMinor: 0, estimated: false };
    subtotal.priceMinor += amount * quantity;
    subtotal.estimated ||= !listing;
    totals.set(currency, subtotal);
  }
  return [...totals.values()];
}

export function safeWebUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? value : undefined;
  } catch { return undefined; }
}

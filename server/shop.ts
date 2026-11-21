// Shopify Shop MCP: price real equipment for each station type.
// Raw JSON-RPC tools/call over HTTP as documented at https://shop.dev/docs/quickstart
// (anonymous search: no key, no session, no initialize call).

import type { FactorySpec } from '../src/spec';

const ENDPOINT = 'https://mcp.shop.com/';
const PROTOCOL = '2026-07-28';
const INCH = 0.0254;

/** What to search for, per station type. Scope: a small light-assembly workshop. */
const QUERIES: Record<string, string> = {
  storage: 'heavy duty steel shelving rack',
  prep: 'stainless steel work table with sink',
  assembly: 'steel workbench',
  test: 'esd anti static workbench',
  pack: 'packing table workbench',
  conveyor: 'roller conveyor',
  cart: 'platform cart',
};

export interface ShopOption {
  title: string;
  seller: string;
  price: number;
  currency: string;
  rating?: number;
  ratingCount?: number;
  /** footprint in metres read from the listing text, when it states one */
  dims?: { w: number; d: number; text: string };
  url: string;
  checkoutUrl?: string;
  image?: string;
  variantId: string;
  description?: string;
  productId: string;
  variantTitle: string;
  sellerDomain: string;
  sellerUrl?: string;
  available: boolean | null;
  priceMinor: number;
  options: { name: string; label: string }[];
  productOptions: { name: string; values: { label: string }[] }[];
  messages?: string[];
}

export interface ShopMessage { type: string; content: string; code?: string; path?: string; severity?: string; links?: { type?: string; url: string }[]; images?: { url: string }[] }
export function messageText(messages: ShopMessage[] = []): string[] {
  return messages.map((m) => [m.content, ...(m.links ?? []).map((l) => l.url), ...(m.images ?? []).map((i) => i.url)].filter(Boolean).join(' '));
}
const knownOffers = new Map<string, { offer: ShopOption; at: number }>();
const OFFER_TTL = 30 * 60_000;

export function knownOffer(variantId: string): ShopOption | undefined {
  const entry = knownOffers.get(variantId);
  if (!entry || Date.now() - entry.at > OFFER_TTL) return undefined;
  return structuredClone(entry.offer);
}

function remember(offer: ShopOption) {
  if (knownOffers.size >= 1500) knownOffers.delete(knownOffers.keys().next().value!);
  knownOffers.set(offer.variantId, { offer: structuredClone(offer), at: Date.now() });
}

/** Restricted server-side transport: payment/completion tools are deliberately absent. */
export async function callShopTool(name: 'search_catalog' | 'get_product' | 'create_checkout' | 'get_checkout', args: object): Promise<any> {
  if (!['search_catalog', 'get_product', 'create_checkout', 'get_checkout'].includes(name)) throw new Error('That Shopify operation is not supported.');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': PROTOCOL,
      'Mcp-Method': 'tools/call',
      'Mcp-Name': name,
    },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name,
        arguments: args,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': PROTOCOL,
          'io.modelcontextprotocol/clientInfo': { name: 'dry-run', version: '0.1.0' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  });
  const json: any = await res.json().catch(() => null);
  // Never put raw responses in errors: checkout documents contain bearer-like access keys.
  if (!res.ok || json?.error || json?.result?.isError) throw new Error(`Shopify could not complete ${name} (${res.status}).`);
  const doc = json?.result?.structuredContent ?? JSON.parse(json?.result?.content?.[0]?.text ?? '{}');
  if (!doc || typeof doc !== 'object' || doc.ucp?.status === 'error') throw new Error(`Shopify returned an invalid ${name} result.`);
  return doc;
}

export async function searchCatalog(query: string, limit: number): Promise<any[]> {
  if (typeof query !== 'string' || !query.trim() || query.length > 500) throw new Error('Use a product search of 1–500 characters.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Search limit must be between 1 and 50.');
  const doc = await callShopTool('search_catalog', { catalog: { query: query.trim(), context: { address_country: 'US', currency: 'USD' }, pagination: { limit } } });
  return Array.isArray(doc.products) ? doc.products.map((p: any) => ({ ...p, messages: [...(p.messages ?? []), ...(doc.messages ?? [])] })) : [];
}

/** Read a width x depth footprint out of listing text such as `48" x 22"`, "48x22 Inch" or "120 x 60 cm". */
export function readDims(text: string): ShopOption['dims'] {
  const m = text.match(/(\d{2,3}(?:\.\d+)?)\s*(?:"|''|in\.?|inch(?:es)?|cm)?\s*[x×]\s*(\d{2,3}(?:\.\d+)?)\s*("|''|in\b\.?|inch(?:es)?|cm)?/i);
  if (!m) return undefined;
  const unit = /cm/i.test(m[0]) ? 0.01 : INCH;
  const a = Number(m[1]) * unit;
  const b = Number(m[2]) * unit;
  if (!(a > 0.2 && a < 6 && b > 0.2 && b < 6)) return undefined;
  const round = (v: number) => Math.round(v * 100) / 100;
  return { w: round(Math.max(a, b)), d: round(Math.min(a, b)), text: m[0].trim() };
}

export function toOption(p: any, selectedVariant?: any): ShopOption | null {
  const v = selectedVariant ?? (p.variants ?? []).find((x: any) => x?.availability?.available) ?? p.variants?.[0];
  if (!Number.isSafeInteger(v?.price?.amount) || v.price.amount < 0 || !v.url || !v.id || !p.id || !v.seller?.domain) return null;
  let fractionDigits: number;
  try { fractionDigits = new Intl.NumberFormat('en', { style: 'currency', currency: v.price.currency }).resolvedOptions().maximumFractionDigits!; } catch { return null; }
  const labels = (v.options ?? []).map((o: any) => o.label).join(' ');
  const plain = String(p.description?.plain ?? '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  return {
    title: String(p.title ?? '').slice(0, 140),
    seller: String(v.seller?.name ?? ''),
    price: v.price.amount / 10 ** fractionDigits,
    currency: String(v.price.currency ?? 'USD'),
    rating: p.rating?.value,
    ratingCount: p.rating?.count,
    dims: readDims(labels) ?? readDims(String(p.title ?? '')) ?? readDims(plain),
    url: v.url, // kept exactly as returned
    image: v.media?.[0]?.url ?? p.media?.[0]?.url,
    variantId: String(v.id),
    description: plain.replace(/\s+/g, ' ').trim().slice(0, 4000),
    productId: String(p.id),
    variantTitle: (v.options ?? []).map((o: any) => `${o.name}: ${o.label}`).join(' · ') || String(v.title ?? 'Default'),
    sellerDomain: String(v.seller.domain),
    sellerUrl: v.seller.url,
    available: typeof v.availability?.available === 'boolean' ? v.availability.available : null,
    priceMinor: v.price.amount,
    options: (v.options ?? []).map((o: any) => ({ name: String(o.name), label: String(o.label) })),
    productOptions: (p.options ?? []).map((o: any) => ({ name: String(o.name), values: (o.values ?? []).map((x: any) => ({ label: String(x.label) })) })),
    messages: messageText(Array.isArray(p.messages) ? p.messages : []),
  };
}

function productListings(product: any, messages: ShopMessage[] = []): ShopOption[] {
  return (Array.isArray(product?.variants) ? product.variants : []).flatMap((variant: any) => {
    const option = toOption({ ...product, messages: [...(product.messages ?? []), ...messages] }, variant);
    if (!option) return [];
    remember(option);
    return [option];
  });
}

export async function getProductListings(id: string, selected?: { name: string; label: string }[]): Promise<ShopOption[]> {
  if (typeof id !== 'string' || !id.startsWith('gid://shopify/') || id.length > 300) throw new Error('Choose a product from the live search results.');
  if (selected !== undefined && (!Array.isArray(selected) || selected.length > 10 || selected.some((o) => typeof o?.name !== 'string' || typeof o?.label !== 'string' || o.name.length > 100 || o.label.length > 200))) throw new Error('Invalid product options.');
  const doc = await callShopTool('get_product', { catalog: { id, ...(selected ? { selected } : {}), context: { address_country: 'US', currency: 'USD' } } });
  const listings = productListings(doc.product, doc.messages ?? []);
  if (selected?.length && listings.some((l) => selected.some((s) => !l.options.some((o) => o.name === s.name && o.label === s.label)))) throw new Error('That exact option combination is unavailable. Choose another option.');
  return listings;
}

export async function priceEquipment(spec: FactorySpec) {
  const types = [...new Set(spec.stations.map((s) => s.type))];
  const results = await Promise.all(
    types.map(async (type) => {
      const query = QUERIES[type] ?? `${type} workbench`;
      const count = spec.stations.filter((s) => s.type === type).length;
      const current = spec.stations.find((s) => s.type === type)!;
      try {
        const options = (await searchCatalog(query, 12))
          .map((p) => toOption(p))
          .filter((o): o is ShopOption => !!o && o.price >= 40)
          // prefer listings that state a footprint and have reviews; then cheapest
          .sort((a, b) => Number(!!b.dims) - Number(!!a.dims) || Number((b.ratingCount ?? 0) > 0) - Number((a.ratingCount ?? 0) > 0) || a.price - b.price)
          .slice(0, 3);
        return { type, query, count, currentPrice: current.price, options, error: options.length ? undefined : 'No usable listings' };
      } catch (e) {
        return { type, query, count, currentPrice: current.price, options: [] as ShopOption[], error: (e as Error).message };
      }
    }),
  );
  return { items: results };
}

/** Free-text search for the plan review screen. Returns listings in the shared ShopListing shape. */
export async function searchListings(query: string, limit = 12): Promise<ShopOption[]> {
  return (await searchCatalog(query, limit)).flatMap((p) => productListings(p));
}

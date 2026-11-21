// Shopify Shop MCP: price real equipment for each station type.
// Raw JSON-RPC tools/call over HTTP as documented at https://shop.dev/docs/quickstart
// (anonymous search: no key, no session, no initialize call).

import { randomUUID } from 'node:crypto';
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
}

/** One Shop MCP tool call. Only the tools named here can be reached; nothing that pays or completes an order is. */
async function callShopTool(name: 'search_catalog' | 'create_checkout', args: object): Promise<any> {
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
  // never put the raw response in an error: a checkout document carries its own access token
  if (!res.ok || json?.error || json?.result?.isError) throw new Error(`Shop could not complete ${name} (${res.status})`);
  return json?.result?.structuredContent ?? JSON.parse(json?.result?.content?.[0]?.text ?? '{}');
}

export async function searchCatalog(query: string, limit: number): Promise<any[]> {
  const doc = await callShopTool('search_catalog', { catalog: { query, context: { address_country: 'US', currency: 'USD' }, pagination: { limit } } });
  return Array.isArray(doc.products) ? doc.products : [];
}

export interface Checkout {
  /** the merchant's own secure checkout page: where the buyer reviews the order and approves payment */
  url: string;
  seller: string;
  currency?: string;
  /** order total in the currency's minor units, as the merchant states it before shipping and tax */
  totalMinor?: number;
  /** true when Shop could not create a checkout and the listing's direct buy link is used instead */
  direct: boolean;
}

/**
 * Buy: turn a listing's buy link into a checkout at its merchant, for the quantity the plan needs.
 * This creates an unpaid checkout and returns where to open it. It never pays: the buyer approves
 * payment on the merchant's page. The merchant and variant are read from the link Shop itself gave us.
 */
export async function createCheckout(buyUrl: string, quantity: number): Promise<Checkout> {
  let link: URL;
  try {
    link = new URL(buyUrl);
  } catch {
    throw new Error('This item has no buy link. Open its listing instead.');
  }
  const variant = /^\/buy\/(\d+):\d+$/.exec(link.pathname)?.[1];
  if (link.protocol !== 'https:' || !variant) throw new Error('This item has no buy link. Open its listing instead.');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw new Error('Quantity must be between 1 and 100.');
  const seller = link.hostname;
  link.pathname = `/buy/${variant}:${quantity}`;
  const direct: Checkout = { url: link.toString(), seller, direct: true };
  try {
    const doc = await callShopTool('create_checkout', {
      shop: seller,
      checkout: { line_items: [{ item: { id: `gid://shopify/ProductVariant/${variant}` }, quantity }], context: { address_country: 'US' } },
      meta: { 'idempotency-key': randomUUID() },
    });
    // trust the checkout only if it is the order that was asked for, at a Shopify or merchant address
    const line = Array.isArray(doc.line_items) && doc.line_items.length === 1 ? doc.line_items[0] : null;
    const url = new URL(String(doc.continue_url));
    const host = url.hostname;
    const safeHost = host === seller || host === 'shop.app' || host === 'checkout.shopify.com' || host.endsWith('.myshopify.com');
    if (!line || !String(line.item?.id ?? '').endsWith(`/${variant}`) || line.quantity !== quantity || url.protocol !== 'https:' || !safeHost || !/^\/(checkouts?|cart\/c)\//.test(url.pathname)) return direct;
    const total = (Array.isArray(doc.totals) ? doc.totals : []).find((t: any) => t?.type === 'total');
    return { url: url.toString(), seller, currency: typeof doc.currency === 'string' ? doc.currency : undefined, totalMinor: Number.isSafeInteger(total?.amount) ? total.amount : undefined, direct: false };
  } catch {
    return direct;
  }
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

export function toOption(p: any): ShopOption | null {
  const v = (p.variants ?? []).find((x: any) => x?.availability?.available) ?? p.variants?.[0];
  if (!v?.price?.amount || !v.url) return null;
  const labels = [...(p.options ?? []).flatMap((o: any) => (o.values ?? []).map((x: any) => x.label)), ...(v.options ?? []).map((o: any) => o.label)].join(' ');
  const plain = String(p.description?.plain ?? '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  return {
    title: String(p.title ?? '').slice(0, 140),
    seller: String(v.seller?.name ?? ''),
    price: v.price.amount / 100, // minor units
    currency: String(v.price.currency ?? 'USD'),
    rating: p.rating?.value,
    ratingCount: p.rating?.count,
    dims: readDims(labels) ?? readDims(String(p.title ?? '')) ?? readDims(plain),
    url: v.url, // kept exactly as returned
    checkoutUrl: v.checkout_url,
    image: v.media?.[0]?.url ?? p.media?.[0]?.url,
    variantId: String(v.id),
    description: plain.replace(/\s+/g, ' ').trim().slice(0, 4000),
  };
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
          .map(toOption)
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
  return (await searchCatalog(query, limit)).map(toOption).filter((o): o is ShopOption => !!o && o.price >= 20);
}

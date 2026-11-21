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
}

async function searchCatalog(query: string, limit: number): Promise<any[]> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': PROTOCOL,
      'Mcp-Method': 'tools/call',
      'Mcp-Name': 'search_catalog',
    },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'search_catalog',
        arguments: { catalog: { query, context: { address_country: 'US', currency: 'USD' }, pagination: { limit } } },
        _meta: {
          'io.modelcontextprotocol/protocolVersion': PROTOCOL,
          'io.modelcontextprotocol/clientInfo': { name: 'dry-run', version: '0.1.0' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok || json?.error) throw new Error(`Shop search failed: ${json?.error?.message ?? res.status}`);
  if (json?.result?.isError) throw new Error(`Shop search tool error: ${JSON.stringify(json.result._meta ?? {}).slice(0, 200)}`);
  const doc = json?.result?.structuredContent ?? JSON.parse(json?.result?.content?.[0]?.text ?? '{}');
  return Array.isArray(doc.products) ? doc.products : [];
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

function toOption(p: any): ShopOption | null {
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

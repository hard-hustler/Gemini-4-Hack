import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommerceError, createApprovedCheckout, secureCheckoutUrl, type CheckoutRequest } from './commerce';
import { callShopTool, getProductListings, searchListings, toOption } from './shop';

let counter = 100;
function product() {
  const id = String(counter++);
  return {
    id: `gid://shopify/p/test${id}`,
    title: 'Workshop table',
    options: [{ name: 'Size', values: [{ label: 'Small' }, { label: 'Large' }] }],
    media: [{ type: 'image', url: 'https://cdn.shopify.com/product.jpg' }],
    variants: [{
      id: `gid://shopify/ProductVariant/${id}`,
      options: [{ name: 'Size', label: 'Small' }],
      price: { amount: 12345, currency: 'USD' },
      availability: { available: true },
      url: 'https://merchant.example/products/table?variant=1&attribution=kept',
      checkout_url: 'https://merchant.example/buy/1',
      seller: { name: 'Merchant', domain: 'merchant.myshopify.com', url: 'https://merchant.example' },
    }],
  };
}

function mockShop(p: ReturnType<typeof product>, overrides: { fresh?: any; checkout?: any; createError?: boolean } = {}) {
  const calls: { name: string; args: any }[] = [];
  const fn = vi.fn(async (_url: unknown, init: RequestInit) => {
    const rpc = JSON.parse(String(init.body));
    calls.push({ name: rpc.params.name, args: rpc.params.arguments });
    expect(init.headers).toMatchObject({ 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Name': rpc.params.name });
    expect(rpc.params._meta['io.modelcontextprotocol/protocolVersion']).toBe('2026-07-28');
    let structuredContent;
    if (rpc.params.name === 'search_catalog') structuredContent = { products: [p], messages: [{ type: 'warning', content: 'Stock changes.' }] };
    else if (rpc.params.name === 'get_product') structuredContent = { product: overrides.fresh ?? p };
    else if (rpc.params.name === 'create_checkout') {
      if (overrides.createError) throw new Error('network failed; private checkout secret must never be exposed');
      structuredContent = (typeof overrides.checkout === 'function' ? overrides.checkout(rpc.params.arguments) : overrides.checkout) ?? { id: 'opaque-checkout-id', status: 'requires_escalation', line_items: rpc.params.arguments.checkout.line_items, continue_url: 'https://merchant.example/checkouts/cn/opaque-key?keep=yes', currency: 'USD', totals: [{ type: 'subtotal', amount: 12345, display_text: 'Subtotal' }], messages: [{ type: 'warning', content: 'Delivery address required.' }], links: [{ type: 'terms', url: 'https://merchant.example/policies/terms' }] };
    } else throw new Error(`Forbidden tool ${rpc.params.name}`);
    return new Response(JSON.stringify({ result: { isError: false, structuredContent } }), { status: 200 });
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

async function setup(overrides: Parameters<typeof mockShop>[1] = {}) {
  const p = product();
  const calls = mockShop(p, overrides);
  const [listing] = await searchListings('workshop table');
  const body: CheckoutRequest = { approved: true, idempotencyKey: randomUUID(), shop: listing.sellerDomain, lines: [{ variantId: listing.variantId, quantity: 1, expectedPriceMinor: listing.priceMinor, currency: listing.currency }] };
  return { p, listing, body, calls };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('live commerce normalization', () => {
  it('keeps every returned variant, merchant photo, exact source URL, currency and availability', async () => {
    const p = product();
    p.variants.push({ ...p.variants[0], id: `gid://shopify/ProductVariant/${counter++}`, options: [{ name: 'Size', label: 'Large' }], availability: { available: false } });
    mockShop(p);
    const listings = await searchListings('workshop table');
    expect(listings).toHaveLength(2);
    expect(listings[0]).toMatchObject({ price: 123.45, priceMinor: 12345, available: true, sellerDomain: 'merchant.myshopify.com', image: 'https://cdn.shopify.com/product.jpg', url: p.variants[0].url, messages: ['Stock changes.'] });
    expect(listings[1].available).toBe(false);
    expect(listings[0].checkoutUrl).toBeUndefined();
  });

  it('uses currency minor units and includes a genuine zero price', () => {
    const p = product();
    p.variants[0].price = { amount: 12345, currency: 'JPY' };
    expect(toOption(p)?.price).toBe(12345);
    p.variants[0].price = { amount: 12345, currency: 'KWD' };
    expect(toOption(p)?.price).toBe(12.345);
    p.variants[0].price.amount = 0;
    expect(toOption(p)?.price).toBe(0);
  });

  it('reads dimensions only from the selected size, not the first available size', () => {
    const p = product();
    p.options = [{ name: 'Size', values: [{ label: '48 x 24 Inch' }, { label: '72 x 30 Inch' }] }];
    p.variants[0].options = [{ name: 'Size', label: '72 x 30 Inch' }];
    expect(toOption(p)?.dims).toMatchObject({ w: 1.83, d: 0.76, text: '72 x 30 Inch' });
  });

  it('rejects a silently relaxed option selection', async () => {
    const p = product();
    mockShop(p);
    await expect(getProductListings(p.id, [{ name: 'Size', label: 'Large' }])).rejects.toThrow('exact option combination');
  });
});

describe('approved merchant checkout', () => {
  it('requires explicit approval before touching Shopify', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(createApprovedCheckout({ approved: false })).rejects.toMatchObject({ status: 403, code: 'APPROVAL_REQUIRED' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses payment tools at the transport boundary', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(callShopTool('complete_checkout' as any, {})).rejects.toThrow('not supported');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects invented variants and mixed merchants', async () => {
    const { body } = await setup();
    await expect(createApprovedCheckout({ ...body, lines: [{ ...body.lines[0], variantId: 'gid://shopify/ProductVariant/999999999' }] })).rejects.toMatchObject({ code: 'SEARCH_REQUIRED' });
    await expect(createApprovedCheckout({ ...body, idempotencyKey: randomUUID(), shop: 'another.myshopify.com' })).rejects.toMatchObject({ code: 'MULTI_MERCHANT' });
  });

  it.each([0, -1, 1.5, 21, Number.MAX_SAFE_INTEGER + 1])('rejects unsafe quantity %s', async (quantity) => {
    const { body, calls } = await setup();
    await expect(createApprovedCheckout({ ...body, lines: [{ ...body.lines[0], quantity }] })).rejects.toBeInstanceOf(CommerceError);
    expect(calls).toHaveLength(1);
  });

  it('requires the buyer’s displayed price and rejects duplicate variants', async () => {
    const { body } = await setup();
    await expect(createApprovedCheckout({ ...body, lines: [{ ...body.lines[0], expectedPriceMinor: undefined }] })).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    await expect(createApprovedCheckout({ ...body, lines: [body.lines[0], body.lines[0]] })).rejects.toBeInstanceOf(CommerceError);
  });

  it.each(['price', 'stock', 'seller'])('revalidates %s and requires another approval on change', async (change) => {
    const { body, p, calls } = await setup();
    if (change === 'price') p.variants[0].price.amount++;
    if (change === 'stock') p.variants[0].availability.available = false;
    if (change === 'seller') p.variants[0].seller.domain = 'other.myshopify.com';
    await expect(createApprovedCheckout(body)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED', status: 409 });
    expect(calls.map((c) => c.name)).toEqual(['search_catalog', 'get_product']);
  });

  it('creates only the approved merchant checkout once and leaves payment unverified', async () => {
    const { body, calls } = await setup();
    const [a, b] = await Promise.all([createApprovedCheckout(body), createApprovedCheckout(body)]);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ status: 'checkout_created', paymentStatus: 'unverified', merchantStatus: 'requires_escalation', messages: ['Delivery address required.'] });
    expect(calls.map((c) => c.name)).toEqual(['search_catalog', 'get_product', 'create_checkout']);
    expect(calls.at(-1)?.args).toEqual({ shop: body.shop, checkout: { line_items: [{ item: { id: body.lines[0].variantId }, quantity: 1 }], context: { address_country: 'US' } }, meta: { 'idempotency-key': body.idempotencyKey } });
    await expect(createApprovedCheckout({ ...body, lines: [{ ...body.lines[0], quantity: 2 }] })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('serializes concurrent approvals with different request keys for the same cart', async () => {
    const { body, calls } = await setup();
    const [a, b] = await Promise.all([createApprovedCheckout(body), createApprovedCheckout({ ...body, idempotencyKey: randomUUID() })]);
    expect(a).toEqual(b);
    expect(calls.filter((c) => c.name === 'create_checkout')).toHaveLength(1);
  });

  it('isolates private checkout URLs and idempotency keys between browser sessions', async () => {
    let creates = 0;
    const { body, calls } = await setup({ checkout: (args: any) => ({ id: `private-checkout-${++creates}`, status: 'incomplete', currency: 'USD', line_items: args.checkout.line_items, continue_url: `https://merchant.example/checkouts/cn/private-${creates}` }) });
    const firstScope = randomUUID();
    const secondScope = randomUUID();
    const [first, second] = await Promise.all([createApprovedCheckout(body, firstScope), createApprovedCheckout(body, secondScope)]);
    expect(first.checkoutUrl).not.toBe(second.checkoutUrl);
    expect(first.id).not.toBe(second.id);
    expect(calls.filter((c) => c.name === 'create_checkout')).toHaveLength(2);
    expect(await createApprovedCheckout(body, firstScope)).toEqual(first);
    expect(await createApprovedCheckout(body, secondScope)).toEqual(second);
    expect(calls.filter((c) => c.name === 'create_checkout')).toHaveLength(2);
  });

  it('allows a manually retried approval after a preflight failure that sent no write', async () => {
    const { body, p, calls } = await setup();
    p.variants[0].availability.available = false;
    await expect(createApprovedCheckout(body)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    p.variants[0].availability.available = true;
    const result = await createApprovedCheckout(body);
    expect(result.paymentStatus).toBe('unverified');
    expect(calls.filter((c) => c.name === 'create_checkout')).toHaveLength(1);
  });

  it('rejects a provider checkout containing a different item or currency', async () => {
    const { body, calls } = await setup({ checkout: { id: 'opaque', status: 'incomplete', currency: 'CAD', line_items: [{ item: { id: 'gid://shopify/ProductVariant/1' }, quantity: 2 }], continue_url: 'https://merchant.example/checkouts/cn/wrong' } });
    await expect(createApprovedCheckout(body)).rejects.toMatchObject({ code: 'CHECKOUT_UNCERTAIN' });
    await expect(createApprovedCheckout({ ...body, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'CHECKOUT_UNCERTAIN' });
    expect(calls.filter((c) => c.name === 'create_checkout')).toHaveLength(1);
  });

  it('rejects unsafe checkout URLs and lookalike domains', async () => {
    const { listing } = await setup();
    for (const url of ['http://merchant.example/checkouts/a', 'https://merchant.example.evil.test/checkouts/a', 'https://user@merchant.example/checkouts/a', 'https://merchant.example/products/table', 'https://127.0.0.1/checkouts/a', 'javascript:alert(1)']) expect(() => secureCheckoutUrl(url, [listing])).toThrow(CommerceError);
    const good = 'https://merchant.example/checkouts/cn/opaque?key=keep';
    expect(secureCheckoutUrl(good, [listing])).toBe(good);
  });

  it('treats an unsafe destination after creation as uncertain and blocks another create', async () => {
    const { body, calls } = await setup({ checkout: (args: any) => ({ id: 'private-checkout', status: 'incomplete', currency: 'USD', line_items: args.checkout.line_items, continue_url: 'https://merchant.example.evil.test/checkouts/cn/private-key' }) });
    await expect(createApprovedCheckout(body)).rejects.toMatchObject({ code: 'CHECKOUT_UNCERTAIN', status: 502 });
    await expect(createApprovedCheckout({ ...body, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'CHECKOUT_UNCERTAIN' });
    expect(calls.filter((c) => c.name === 'create_checkout')).toHaveLength(1);
  });

  it('does not retry an uncertain create, including with a different key', async () => {
    const { body, calls } = await setup({ createError: true });
    await expect(createApprovedCheckout(body)).rejects.toMatchObject({ code: 'CHECKOUT_UNCERTAIN' });
    await expect(createApprovedCheckout(body)).rejects.toMatchObject({ code: 'CHECKOUT_UNCERTAIN' });
    await expect(createApprovedCheckout({ ...body, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'CHECKOUT_UNCERTAIN' });
    expect(calls.filter((c) => c.name === 'create_checkout')).toHaveLength(1);
  });
});

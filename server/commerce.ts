import { callShopTool, getProductListings, knownOffer, messageText, type ShopOption } from './shop';

export class CommerceError extends Error {
  constructor(message: string, public status = 400, public code = 'INVALID_CHECKOUT', public refreshedListings?: ShopOption[]) { super(message); }
}

export interface CheckoutRequest {
  approved: true;
  idempotencyKey: string;
  shop: string;
  lines: { variantId: string; quantity: number; expectedPriceMinor: number; currency: string }[];
}

export interface CreatedCheckout {
  id: string;
  shop: string;
  checkoutUrl: string;
  status: 'checkout_created';
  paymentStatus: 'unverified';
  merchantStatus: string;
  currency?: string;
  totals?: { type: string; amount: number; display_text?: string }[];
  messages: string[];
  links: { type?: string; url: string }[];
}

const operations = new Map<string, { fingerprint: string; promise: Promise<CreatedCheckout>; at: number }>();
const carts = new Map<string, { fingerprint: string; promise: Promise<CreatedCheckout>; at: number }>();
const uncertainCarts = new Map<string, number>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RETENTION = 6 * 60 * 60_000;

function validateRequest(input: unknown): CheckoutRequest {
  const body = input as Partial<CheckoutRequest> | null;
  if (!body || body.approved !== true) throw new CommerceError('Review this merchant’s cart and explicitly approve creating checkout first.', 403, 'APPROVAL_REQUIRED');
  if (typeof body.idempotencyKey !== 'string' || !UUID.test(body.idempotencyKey)) throw new CommerceError('A valid checkout request key is required.');
  if (typeof body.shop !== 'string' || !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(body.shop)) throw new CommerceError('Select a merchant from the live results.');
  if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 30) throw new CommerceError('Choose between 1 and 30 product variants.');
  const ids = new Set<string>();
  let quantity = 0;
  for (const line of body.lines) {
    if (!line || typeof line.variantId !== 'string' || !/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(line.variantId) || ids.has(line.variantId)) throw new CommerceError('Each line must identify a unique live product variant.');
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 20) throw new CommerceError('Quantity must be a whole number between 1 and 20.');
    if (!Number.isSafeInteger(line.expectedPriceMinor) || line.expectedPriceMinor < 0 || typeof line.currency !== 'string' || !/^[A-Z]{3}$/.test(line.currency)) throw new CommerceError('Review the current price and currency before approving checkout.', 409, 'APPROVAL_REQUIRED');
    ids.add(line.variantId);
    quantity += line.quantity;
  }
  if (quantity > 100) throw new CommerceError('At most 100 units can be checked out at once.');
  return body as CheckoutRequest;
}

/** Checkout URLs are returned only by Shopify, then constrained to verified merchant hosts. */
export function secureCheckoutUrl(value: unknown, offers: ShopOption[]): string {
  if (typeof value !== 'string') throw new CommerceError('The merchant did not provide a secure checkout link.', 502, 'CHECKOUT_UNAVAILABLE');
  let url: URL;
  try { url = new URL(value); } catch { throw new CommerceError('The merchant returned an invalid checkout link.', 502, 'CHECKOUT_UNAVAILABLE'); }
  const hosts = new Set(['checkout.shopify.com', 'shop.app', 'shop.com']);
  for (const offer of offers) {
    hosts.add(offer.sellerDomain);
    if (offer.sellerUrl) { try { const seller = new URL(offer.sellerUrl); if (seller.protocol === 'https:') hosts.add(seller.hostname); } catch { /* invalid merchant URL is never trusted */ } }
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || !hosts.has(url.hostname) || !/^\/(?:checkouts(?:\/|$)|checkout(?:\/|$)|cart\/c\/)/.test(url.pathname)) throw new CommerceError('The merchant did not return a verified secure checkout destination.', 502, 'CHECKOUT_UNAVAILABLE');
  return value;
}

async function prepareCheckout(body: CheckoutRequest, cartSignature: string): Promise<CreatedCheckout> {
  const trusted = body.lines.map((line) => {
    const offer = knownOffer(line.variantId);
    if (!offer) throw new CommerceError('This product needs a fresh live search before checkout.', 409, 'SEARCH_REQUIRED');
    if (offer.sellerDomain !== body.shop) throw new CommerceError('Use a separate checkout for each merchant.', 409, 'MULTI_MERCHANT');
    return offer;
  });
  if (new Set(body.lines.map((l) => l.currency)).size !== 1) throw new CommerceError('Separate products priced in different currencies before checkout.', 409, 'CURRENCY_MISMATCH');
  const current: ShopOption[] = [];
  for (let i = 0; i < trusted.length; i++) {
    const previous = trusted[i];
    let fresh: ShopOption[];
    try { fresh = await getProductListings(previous.productId, previous.options); }
    catch { throw new CommerceError('The merchant could not verify that exact option. Search again before checkout.', 409, 'APPROVAL_REQUIRED'); }
    const offer = fresh.find((l) => l.variantId === previous.variantId);
    const line = body.lines[i];
    if (!offer || offer.available !== true || offer.sellerDomain !== body.shop || offer.priceMinor !== line.expectedPriceMinor || offer.currency !== line.currency) throw new CommerceError('Price, availability or seller changed. Review the refreshed products and approve again.', 409, 'APPROVAL_REQUIRED', fresh);
    current.push(offer);
  }
  // Once a write is sent, a transport failure may still have created checkout. Never retry it.
  if (uncertainCarts.has(cartSignature)) throw new CommerceError('A checkout for this cart may already exist. Check with the merchant before trying again.', 409, 'CHECKOUT_UNCERTAIN');
  uncertainCarts.set(cartSignature, Date.now());
  let document: any;
  try {
    document = await callShopTool('create_checkout', {
      shop: body.shop,
      checkout: { line_items: body.lines.map((l) => ({ item: { id: l.variantId }, quantity: l.quantity })), context: { address_country: 'US' } },
      meta: { 'idempotency-key': body.idempotencyKey },
    });
  } catch {
    throw new CommerceError('Checkout creation could not be confirmed. Do not retry this cart; check with the merchant before starting another checkout.', 502, 'CHECKOUT_UNCERTAIN');
  }
  if (typeof document.id !== 'string' || !document.id) throw new CommerceError('Checkout creation could not be confirmed. Do not retry this cart.', 502, 'CHECKOUT_UNCERTAIN');
  const returnedLines = document.line_items;
  const matches = Array.isArray(returnedLines) && returnedLines.length === body.lines.length && body.lines.every((line) => returnedLines.filter((r: any) => r.item?.id === line.variantId && r.quantity === line.quantity).length === 1);
  if (!matches || document.currency !== body.lines[0].currency || !['incomplete', 'requires_escalation', 'ready_for_complete'].includes(document.status)) throw new CommerceError('The merchant returned different checkout items, currency or status. Do not retry; review this with the merchant.', 502, 'CHECKOUT_UNCERTAIN');
  let checkoutUrl: string;
  try { checkoutUrl = secureCheckoutUrl(document.continue_url, current); }
  catch { throw new CommerceError('The merchant returned a checkout without a verified secure link. Do not retry this cart; check with the merchant.', 502, 'CHECKOUT_UNCERTAIN'); }
  const result: CreatedCheckout = {
    id: document.id,
    shop: body.shop,
    checkoutUrl,
    status: 'checkout_created',
    paymentStatus: 'unverified',
    merchantStatus: typeof document.status === 'string' ? document.status : 'unknown',
    currency: typeof document.currency === 'string' ? document.currency : undefined,
    totals: Array.isArray(document.totals) ? document.totals.filter((t: any) => typeof t.type === 'string' && Number.isSafeInteger(t.amount)).map((t: any) => ({ type: t.type, amount: t.amount, display_text: typeof t.display_text === 'string' ? t.display_text : undefined })) : [],
    messages: messageText(Array.isArray(document.messages) ? document.messages : []),
    links: Array.isArray(document.links) ? document.links.filter((l: any) => typeof l.url === 'string' && l.url.startsWith('https://')).map((l: any) => ({ type: l.type, url: l.url })) : [],
  };
  uncertainCarts.delete(cartSignature);
  return result;
}

/** Explicit approval prepares a merchant checkout. It never pays or claims an order exists. */
export async function createApprovedCheckout(input: unknown, scope = 'local-cli'): Promise<CreatedCheckout> {
  if (typeof scope !== 'string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(scope)) throw new CommerceError('A valid private checkout session is required.', 403, 'SESSION_REQUIRED');
  const body = validateRequest(input);
  const operationKey = JSON.stringify([scope, body.idempotencyKey]);
  const fingerprint = JSON.stringify({ shop: body.shop, lines: [...body.lines].sort((a, b) => a.variantId.localeCompare(b.variantId)) });
  const cartSignature = JSON.stringify({ scope, shop: body.shop, lines: [...body.lines].sort((a, b) => a.variantId.localeCompare(b.variantId)).map((l) => ({ variantId: l.variantId, quantity: l.quantity })) });
  for (const [key, operation] of operations) if (Date.now() - operation.at > RETENTION) operations.delete(key);
  for (const [key, operation] of carts) if (Date.now() - operation.at > RETENTION) carts.delete(key);
  for (const [key, at] of uncertainCarts) if (Date.now() - at > RETENTION) uncertainCarts.delete(key);
  const existing = operations.get(operationKey);
  if (existing) {
    if (existing.fingerprint !== fingerprint) throw new CommerceError('That approval key belongs to a different cart. Review the cart again.', 409, 'IDEMPOTENCY_CONFLICT');
    return existing.promise;
  }
  if (uncertainCarts.has(cartSignature)) throw new CommerceError('A checkout for this cart may already exist. Check with the merchant before trying again.', 409, 'CHECKOUT_UNCERTAIN');
  const cart = carts.get(cartSignature);
  if (cart) {
    if (cart.fingerprint !== fingerprint) throw new CommerceError('This cart already has a checkout. Review it with the merchant before starting another.', 409, 'CHECKOUT_EXISTS');
    return cart.promise;
  }
  if (operations.size >= 1000) throw new CommerceError('Checkout is temporarily busy. Try later.', 503, 'CHECKOUT_BUSY');
  const promise = Promise.resolve().then(() => prepareCheckout(body, cartSignature));
  operations.set(operationKey, { fingerprint, promise, at: Date.now() });
  carts.set(cartSignature, { fingerprint, promise, at: Date.now() });
  // A failed preflight sent no write, so the shopper may review updated products and approve again.
  void promise.catch(() => {
    if (!uncertainCarts.has(cartSignature)) {
      if (carts.get(cartSignature)?.promise === promise) carts.delete(cartSignature);
      if (operations.get(operationKey)?.promise === promise) operations.delete(operationKey);
    }
  });
  return promise;
}

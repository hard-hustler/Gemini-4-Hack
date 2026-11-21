import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { ShopListing } from '../contracts';
import { addCartLine, canPurchase, cartFingerprint, cartKey, formatPrice, groupCart, MAX_CART_QUANTITY, safeWebUrl, updateCartQuantity, type CartLine } from '../commerce';
import { api } from '../store';
import { Icon } from './icons';
import './commerce.css';

interface CommerceState {
  lines: CartLine[];
  add: (listing: ShopListing, quantity?: number) => void;
  openCart: () => void;
}
const CommerceContext = createContext<CommerceState | null>(null);

export function useCommerce() {
  const state = useContext(CommerceContext);
  if (!state) throw new Error('CommerceProvider is required');
  return state;
}

export function ShopifyAttribution() {
  return <a className="shopify-attribution" href="https://www.shopify.com/" target="_blank" rel="noopener noreferrer">Powered by Shopify</a>;
}

/** Native modal supplies focus containment, Escape dismissal and focus restoration. */
export function CommerceDrawer({ title, onClose, children, isOpen = true }: { title: string; onClose: () => void; children: ReactNode; isOpen?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const node = dialog.current!;
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    node.showModal();
    document.body.style.overflow = 'hidden';
    return () => { node.close(); document.body.style.overflow = previousOverflow; };
  }, [isOpen]);
  return (
    <dialog ref={dialog} className="commerce-dialog" aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="drawer commerce-drawer">
        <header>
          <h2 id={titleId}>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={`Close ${title}`} autoFocus><Icon name="x" /></button>
        </header>
        {children}
      </aside>
    </dialog>
  );
}

export function AddToCartButton({ listing, quantity = 1, disabled = false }: { listing: ShopListing; quantity?: number; disabled?: boolean }) {
  const { add } = useCommerce();
  const [added, setAdded] = useState(false);
  return (
    <button className="ghost sm" disabled={disabled || quantity > MAX_CART_QUANTITY || !canPurchase(listing)} onClick={() => { add(listing, quantity); setAdded(true); }} title={quantity > MAX_CART_QUANTITY ? 'Add at most 20 units of a variant at a time' : !canPurchase(listing) ? 'Search again for current variant, merchant, price and availability before adding' : undefined}>
      {added ? 'Added · add again' : 'Add to cart'}
    </button>
  );
}

/** One shared merchant-photo card in both the team's catalog and replacement drawer. */
export function ShopProductCard({ listing: initial, onUse, busy = false }: { listing: ShopListing; onUse?: (listing: ShopListing) => void; busy?: boolean }) {
  const [listing, setListing] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const image = safeWebUrl(listing.image);
  const href = safeWebUrl(listing.url);
  const changeVariant = async (name: string, label: string) => {
    if (!listing.productId) return;
    const selected = [...(listing.options ?? []).filter((option) => option.name !== name), { name, label }];
    setLoading(true);
    setError(null);
    try {
      const result = await api<{ listings: ShopListing[] }>('/api/catalog/product', { id: listing.productId, selected });
      const next = result.listings.find((candidate) => selected.every((option) => candidate.options?.some((value) => value.name === option.name && value.label === option.label)));
      if (!next) throw new Error('This variant combination is unavailable. Choose another option.');
      setListing(next);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };
  return (
    <article className="listing shop-product" aria-busy={loading}>
      {image ? <img src={image} alt={listing.title} loading="lazy" /> : <div className="listing-blank" aria-label="Merchant photo unavailable" />}
      <div className="listing-body">
        <b>{listing.title}</b>
        <span>{listing.seller}{listing.rating ? ` · rated ${listing.rating}` : ''}</span>
        {listing.variantTitle && <span>Variant: {listing.variantTitle}</span>}
        <span>{listing.available === true ? 'Available' : listing.available === false ? 'Unavailable' : 'Availability unknown — search again before buying'}</span>
        {listing.dims && <span>{listing.dims.w} × {listing.dims.d} m · verify measurements for the selected variant</span>}
        {listing.productId && listing.productOptions?.map((option) => (
          <label className="variant-option" key={option.name}>
            <span>{option.name}</span>
            <select aria-label={`${option.name} for ${listing.title}`} value={listing.options?.find((value) => value.name === option.name)?.label ?? ''} disabled={loading || busy} onChange={(e) => void changeVariant(option.name, e.target.value)}>
              <option value="" disabled>Select {option.name}</option>
              {option.values.map((value) => <option key={value.label} value={value.label}>{value.label}</option>)}
            </select>
          </label>
        ))}
        {(listing.messages ?? []).map((message, index) => <p className="small commerce-warning" key={index}>{message}</p>)}
        {loading && <span role="status">Checking the selected variant…</span>}
        {error && <p role="alert" className="commerce-warning small">{error}</p>}
        <div className="listing-foot">
          <strong>{formatPrice(listing)}</strong>
          {href && <a className="small" href={href} target="_blank" rel="noopener noreferrer">Listing</a>}
          {onUse && <button className="ghost sm" disabled={busy || loading} onClick={() => onUse(listing)}>{busy ? 'Reading specs' : 'Use this'}</button>}
          <AddToCartButton key={cartKey(listing)} listing={listing} disabled={loading || busy} />
        </div>
      </div>
    </article>
  );
}

export function CommerceCartButton() {
  const { lines, openCart } = useCommerce();
  const count = lines.reduce((total, line) => total + line.quantity, 0);
  return <button className="ghost sm" onClick={openCart} aria-label={`Open cart, ${count} items`}>Cart{count ? ` (${count})` : ''}</button>;
}

type CartGroup = ReturnType<typeof groupCart>[number];
interface CreatedCheckout {
  id: string; shop: string; checkoutUrl: string; status: 'checkout_created'; paymentStatus: 'unverified';
  merchantStatus?: string; currency?: string;
  totals?: { type: string; amount: number; display_text?: string }[];
  messages?: string[]; links?: { type?: string; url: string }[];
}
interface CheckoutSession {
  approved: boolean; busy: boolean; error: string | null; checkout: CreatedCheckout | null;
  requestId: string | null; uncertain: boolean;
}
const EMPTY_SESSION: CheckoutSession = { approved: false, busy: false, error: null, checkout: null, requestId: null, uncertain: false };

function MerchantCheckout({ group, session, patchSession, updateQuantity, refresh }: { group: CartGroup; session: CheckoutSession; patchSession: (patch: Partial<CheckoutSession>) => void; updateQuantity: (key: string, quantity: number) => void; refresh: (listings: ShopListing[]) => void }) {
  const { approved, busy, error, checkout, uncertain } = session;
  const inFlight = useRef(false);
  const approvalId = useId();
  const withinLimits = group.lines.length <= 30 && group.lines.reduce((sum, line) => sum + line.quantity, 0) <= 100;
  const eligible = withinLimits && group.lines.every((line) => canPurchase(line.listing));
  const createCheckout = async () => {
    if (!approved || busy || inFlight.current || uncertain || !eligible) return;
    inFlight.current = true;
    const requestId = session.requestId ?? crypto.randomUUID();
    patchSession({ busy: true, error: null, requestId });
    try {
      const response = await fetch('/api/commerce/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: true, idempotencyKey: requestId, shop: group.shop, lines: group.lines.map(({ listing, quantity }) => ({ variantId: listing.variantId, quantity, expectedPriceMinor: listing.priceMinor, currency: listing.currency })) }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.code === 'APPROVAL_REQUIRED') {
          patchSession({ approved: false, requestId: null, error: `${result.error ?? 'The merchant details changed.'} Review current prices and availability, then approve again. Search and add the product again if no refreshed details are shown.` });
          if (Array.isArray(result.refreshedListings)) refresh(result.refreshedListings);
        } else if (result.code === 'CHECKOUT_UNCERTAIN' || result.code === 'CHECKOUT_UNKNOWN') {
          patchSession({ uncertain: true, error: `${result.error ?? 'A checkout may already exist.'} Check with the merchant before starting another checkout. No payment is verified.` });
        } else {
          // Server validation failures did not create checkout; require another review.
          patchSession({ approved: false, requestId: null, error: result.error ?? 'Checkout creation failed. Review this cart before trying again.' });
        }
        return;
      }
      if (result.shop !== group.shop || result.status !== 'checkout_created' || result.paymentStatus !== 'unverified' || !safeWebUrl(result.checkoutUrl)) {
        patchSession({ uncertain: true, error: 'Checkout response could not be verified. Check with the merchant before starting another checkout. No order or payment is confirmed.' });
        return;
      }
      patchSession({ checkout: result });
    } catch {
      // The server retains request IDs: a shopper-triggered retry can retrieve that same operation.
      patchSession({ error: 'The connection ended before checkout creation could be confirmed. A manual retry uses the same request ID. No payment is verified.' });
    } finally {
      inFlight.current = false;
      patchSession({ busy: false });
    }
  };
  return (
    <section className="merchant-cart" aria-label={`Checkout for ${group.seller} in ${group.currency}`}>
      <h3>{group.seller}</h3>
      <p className="muted small">{group.shop} · {group.currency}</p>
      {group.lines.map(({ listing, quantity }) => (
        <div className="cart-line" key={cartKey(listing)}>
          <div>
            <b>{listing.title}</b>
            {listing.variantTitle && <span className="small">{listing.variantTitle}</span>}
            <span className="small">{listing.available === true ? 'Available at last lookup' : 'Unavailable or needs a fresh search'} · {formatPrice(listing)} each</span>
            <span className="small cart-variant">{listing.variantId}</span>
          </div>
          <div className="row cart-row">
            <label className="small cart-quantity">
              Quantity{' '}
              <input
                type="number"
                min={0}
                max={MAX_CART_QUANTITY}
                value={quantity}
                disabled={busy}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  updateQuantity(cartKey(listing), Math.max(0, val));
                }}
                aria-label={`Quantity of ${listing.title}`}
              />
            </label>
            <strong>{formatPrice(listing, quantity)}</strong>
            <button
              className="cart-remove-btn"
              type="button"
              disabled={busy}
              onClick={() => updateQuantity(cartKey(listing), 0)}
              title={`Remove ${listing.title} from cart`}
            >
              ✕ Remove
            </button>
          </div>
          {(listing.messages ?? []).map((message, index) => <p className="small commerce-warning" key={index}>{message}</p>)}
        </div>
      ))}
      <p className="cart-subtotal"><b>Item subtotal</b><strong>{formatPrice({ price: 0, priceMinor: group.subtotalMinor, currency: group.currency })}</strong></p>
      <p className="muted small">Shipping, taxes and final availability are confirmed by the merchant at checkout. Creating a checkout does not place or pay for an order.</p>
      {!withinLimits && <p className="commerce-warning small" role="alert">Each checkout supports up to 30 variants and 100 total items. Reduce quantities or remove items before continuing.</p>}
      {!checkout && <>
        <label className="checkout-approval" htmlFor={approvalId}><input id={approvalId} type="checkbox" checked={approved} disabled={busy || uncertain || !eligible} onChange={(e) => patchSession({ approved: e.target.checked })} /><span>I approve creating a secure Shopify checkout for these {group.seller} items and quantities at the prices shown.</span></label>
        <button className="primary" disabled={!approved || !eligible || busy || uncertain} onClick={() => void createCheckout()}>{busy ? 'Creating checkout…' : uncertain ? 'Checkout status uncertain' : error && session.requestId ? 'Retry same checkout request' : 'Create secure checkout'}</button>
      </>}
      {error && <p role="alert" className="commerce-warning small">{error}</p>}
      {checkout && <div className="checkout-ready" role="status">
        <b>Checkout created · payment unverified</b>
        <p className="small">No order or payment has been confirmed. Open Shopify to review the final total. Only you can choose to pay.</p>
        {(checkout.totals ?? []).map((total, index) => <p className="cart-subtotal small" key={index}><span>{total.display_text ?? total.type}</span><strong>{formatPrice({ price: 0, priceMinor: total.amount, currency: checkout.currency ?? group.currency })}</strong></p>)}
        {(checkout.messages ?? []).map((message, index) => <p className="commerce-warning small" key={index}>{message}</p>)}
        {(checkout.links ?? []).filter((link) => safeWebUrl(link.url)).map((link, index) => <a className="small" href={safeWebUrl(link.url)} target="_blank" rel="noopener noreferrer" key={index}>{link.type?.replaceAll('_', ' ') ?? 'Merchant terms and information'} ↗</a>)}
        <a className="primary" href={checkout.checkoutUrl} target="_blank" rel="noopener noreferrer">Open secure Shopify checkout ↗</a>
      </div>}
    </section>
  );
}

export function CommerceProvider({ children }: { children: ReactNode }) {
  // Checkout URLs and cart details live only for this app session; never persist checkout tokens.
  const [lines, setLines] = useState<CartLine[]>([]);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [cartWarning, setCartWarning] = useState('');
  const [sessions, setSessions] = useState<Record<string, CheckoutSession>>({});
  const patchSession = (key: string, patch: Partial<CheckoutSession>) => setSessions((current) => ({ ...current, [key]: { ...(current[key] ?? EMPTY_SESSION), ...patch } }));
  const add = (listing: ShopListing, quantity = 1) => {
    if (!canPurchase(listing)) return;
    setLines((current) => addCartLine(current, listing, quantity));
    setNotice(`${listing.title} added to cart. Review the cart to create a checkout.`);
  };
  const groups = groupCart(lines);
  const refresh = (listings: ShopListing[]) => {
    setCartWarning('The merchant refreshed product details. Review prices, variants and availability below, then approve again. No payment has been verified.');
    setLines((current) => current.map((line) => {
      const fresh = listings.find((listing) => cartKey(listing) === cartKey(line.listing));
      return fresh ? { ...line, listing: fresh } : line;
    }));
  };
  return <CommerceContext.Provider value={{ lines, add, openCart: () => setOpen(true) }}>
    {children}
    <span className="commerce-announcement" role="status">{notice}</span>
    <CommerceDrawer title="Your cart" isOpen={open} onClose={() => setOpen(false)}>
      <ShopifyAttribution />
      {cartWarning && <p className="commerce-warning small" role="alert">{cartWarning}</p>}
      {!lines.length ? <p className="muted">Your cart is empty. Search the machine catalog or replace equipment with a live Shopify listing to add products.</p> : <>
        <p className="muted small">Each merchant and currency has its own checkout and requires separate approval. Up to 20 units per variant. Cart contents are kept only until this app reloads.</p>
        {groups.map((group) => {
          const key = `${group.key}|${cartFingerprint(group.lines)}`;
          return <MerchantCheckout key={key} group={group} session={sessions[key] ?? EMPTY_SESSION} patchSession={(patch) => patchSession(key, patch)} updateQuantity={(lineKey, quantity) => setLines((current) => updateCartQuantity(current, lineKey, quantity))} refresh={refresh} />;
        })}
      </>}
    </CommerceDrawer>
  </CommerceContext.Provider>;
}

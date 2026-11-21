// Safe by default: live catalog reads only. Optional flags prepare one unpaid checkout.
// Never log its ID, access key, full URL, or raw provider response.
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createApprovedCheckout } from '../server/commerce';
import { getProductListings, searchListings } from '../server/shop';

const args = process.argv.slice(2);
const create = args.includes('--create-checkout');
if (create && !args.includes('--approve')) throw new Error('Creating a checkout requires both --create-checkout and --approve. No payment is ever performed.');
const queryIndex = args.indexOf('--query');
const query = queryIndex >= 0 ? args[queryIndex + 1] : 'steel workbench';
assert(query, 'Supply a search query.');
const listings = await searchListings(query, 4);
assert(listings.length > 0, 'Live search returned no usable listings.');
const selected = listings.find((listing) => listing.available === true && listing.image && listing.priceMinor > 0);
assert(selected, 'No available listing with a merchant photo was returned.');
const resolved = await getProductListings(selected.productId, selected.options);
const offer = resolved.find((listing) => listing.variantId === selected.variantId && listing.available === true);
assert(offer, 'The featured variant could not be confirmed by a fresh product read.');
assert(offer.sellerDomain && offer.variantId && offer.image && offer.url, 'Live listing metadata is incomplete.');
console.log(JSON.stringify({
  search: 'passed',
  query,
  resultCount: listings.length,
  product: {
    title: offer.title,
    seller: offer.seller,
    variant: offer.variantTitle,
    price: offer.price,
    currency: offer.currency,
    available: offer.available,
    hasMerchantPhoto: Boolean(offer.image),
  },
  exactVariantRead: 'passed',
}, null, 2));

if (create) {
  const checkout = await createApprovedCheckout({
    approved: true,
    idempotencyKey: randomUUID(),
    shop: offer.sellerDomain,
    lines: [{ variantId: offer.variantId, quantity: 1, expectedPriceMinor: offer.priceMinor, currency: offer.currency }],
  });
  assert.equal(checkout.status, 'checkout_created');
  assert.equal(checkout.paymentStatus, 'unverified');
  assert.equal(checkout.shop, offer.sellerDomain);
  const destination = new URL(checkout.checkoutUrl);
  assert.equal(destination.protocol, 'https:');
  console.log(JSON.stringify({
    createCheckout: 'passed',
    secureDestinationHost: destination.hostname,
    merchantStatus: checkout.merchantStatus,
    paymentStatus: checkout.paymentStatus,
    messageCount: checkout.messages.length,
    paymentAttempted: false,
    orderVerified: false,
  }, null, 2));
} else {
  console.log('Checkout creation skipped (read-only smoke test).');
}

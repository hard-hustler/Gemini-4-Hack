# Shopify commerce in Dry Run

This extends the team's React equipment drawer, machine catalog, top bar and
simulation bill. The factory engines, Gemini harness and 3D components remain
the existing application. No standalone StudioForge UI is included.

## Run and demo

Use Node 24 (`nvm use` if installed). Run `npm ci` when dependencies are missing
or an older `node_modules` does not match the lockfile, then `npm run dev`.
Open http://localhost:5173. Shopify search needs internet access; it needs no
API key. The existing model/conversion buttons still need the team's
server-only `GEMINI_API_KEY` in `.env`. Never put that key in browser code.
`npm run dev` loads that file when present. If another teammate server is
using port 8787, run `PORT=8788 npm run dev`; Vite's API proxy follows the
same port. Use the web URL printed by Vite if 5173 is already occupied.

1. Open **Catalog** from the home screen and search for `steel workbench`.
   The existing Equipment → Replace drawer uses the same live catalog.
2. Review the merchant photo, seller, exact variant, currency and availability.
   Variant selectors resolve the choice with Shop before it can be added.
3. Add to cart; edit quantities or remove items. Catalog replacements can
   still use the team's listing-to-3D converter. A built-in model is not a
   buyable Shopify listing.
4. Open **Cart**. Each merchant/currency has its own checkout and approval.
   Review the item subtotal (shipping/tax are finalized by the merchant),
   explicitly approve that group, then create its secure checkout.
5. The shopper can choose to open the returned secure checkout. Creating or
   opening a checkout does not mean an order was placed or payment succeeded.
   Do not enter card details or pay during a demo.

The cart and private checkout results live in memory. Reloading clears them;
checkout URLs and access keys are not saved in project storage. Old saved
projects without commerce metadata still open; search again to buy an item.
Listings carried by a new layout/version retain their merchant and variant.

## Integration boundary

- `server/shop.ts`: anonymous JSON-RPC Shop MCP adapter at
  `https://mcp.shop.com/`, protocol `2026-07-28`. Prices retain exact ISO
  currency minor units, real returned media and full listing URLs. Unknown
  availability never grants permission to buy.
- `POST /api/catalog/search {query}` returns `{listings}`.
- `POST /api/catalog/product {id,selected?:[{name,label}]}` resolves variants.
- `POST /api/commerce/checkout` accepts only an explicitly approved single
  merchant group:

  ```json
  {
    "approved": true,
    "shop": "merchant.myshopify.com",
    "idempotencyKey": "a fresh UUID per approved cart revision",
    "lines": [{"variantId":"exact returned ID","quantity":1,"expectedPriceMinor":12345,"currency":"USD"}]
  }
  ```

  The server accepts recently discovered listings, refreshes the product,
  checks stock, exact variant, merchant, currency and approved price, and
  calls only `create_checkout`. A changed offer requires fresh review.
  An ambiguous create outcome must not be retried with a new key.
  Responses are `no-store`; private checkout IDs/URLs must not be logged.

There is no payment/complete-checkout endpoint and no paid/success state in
this integration. `paymentStatus` is always `unverified`. Actual payment
verification would require a verified order through an authorized merchant
integration; a redirect or a checkout session is insufficient.

The commerce transport exposes only search, product reads, checkout creation
and checkout reads. It sends no customer identity, address or card data.
Multi-store carts deliberately remain separate checkouts.

## Checks and sources

Run `npm test` and `npm run build`. `npm run test:shopify:live` performs an
anonymous live search and variant read. Its optional
`--create-checkout --approve` flags create one **unpaid** checkout for one
available listing; they never open a payment page or complete an order.
The smoke script prints only redacted checkout metadata. Live catalog,
availability, merchant eligibility and endpoint uptime can change.

Official references: [Shop MCP quickstart](https://shop.dev/docs/quickstart),
[search and variant resolution](https://shop.dev/docs/search),
[single-store checkout](https://shop.dev/docs/checkout),
[errors and retries](https://shop.dev/docs/errors),
[Shopify brand assets](https://www.shopify.com/brand-assets).
The UI uses a secondary plain-text **Powered by Shopify** attribution with a
link. It does not modify Shopify logos or imply Shopify endorsement.

The local parent folder was inspected before reuse: the named Payment Demo
ZIP/folder were absent. The older `StudioForge_Procurement_Phase1.zip` and
its extracted files contain a standalone procurement prototype, not payment
acceptance code; none of its UI or recorded prices are used as live results.

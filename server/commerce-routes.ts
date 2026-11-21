import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { CommerceError, createApprovedCheckout } from './commerce';
import { getProductListings, searchListings } from './shop';

type Services = {
  search: typeof searchListings;
  product: typeof getProductListings;
  checkout: typeof createApprovedCheckout;
};

/** The commerce boundary deliberately exposes no payment or complete-checkout tool. */
export function commerceRoutes(services: Services = { search: searchListings, product: getProductListings, checkout: createApprovedCheckout }) {
  const router = Router();
  router.use(['/api/catalog/search', '/api/catalog/product', '/api/commerce'], (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  router.post('/api/catalog/search', async (req, res) => {
    const query = req.body?.query;
    if (typeof query !== 'string' || !query.trim() || query.length > 300) {
      return void res.status(400).json({ error: 'Enter a search query of 1–300 characters.' });
    }
    try {
      res.json({ listings: await services.search(query.trim()) });
    } catch {
      res.status(502).json({ error: 'Shop search is unavailable. Try again shortly.' });
    }
  });
  router.post('/api/catalog/product', async (req, res) => {
    const { id, selected } = req.body ?? {};
    if (typeof id !== 'string' || !id || id.length > 2000 || (selected !== undefined &&
      (!Array.isArray(selected) || selected.length > 12 || selected.some((o: unknown) => {
        const choice = o as { name?: unknown; label?: unknown } | null;
        return !choice || typeof choice.name !== 'string' || typeof choice.label !== 'string' ||
          !choice.name || !choice.label || choice.name.length > 200 || choice.label.length > 500;
      })))) {
      return void res.status(400).json({ error: 'A product ID and valid variant options are required.' });
    }
    try {
      res.json({ listings: await services.product(id, selected) });
    } catch (error) {
      if (error instanceof CommerceError) return void res.status(error.status).json({ error: error.message, code: error.code });
      res.status(502).json({ error: 'That variant could not be loaded. Search again or choose another option.' });
    }
  });
  router.post('/api/commerce/checkout', async (req, res) => {
    // JSON requests from another website must not create a merchant session.
    const origin = req.get('origin');
    if (origin) {
      let sameOrigin = false;
      try { sameOrigin = new URL(origin).host === req.get('host'); } catch { /* reject malformed origins */ }
      if (!sameOrigin) return void res.status(403).json({ error: 'Create checkout from this app after reviewing your cart.' });
    }
    try {
      // Checkout access keys must never be shared between browsers with identical carts.
      const cookie = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('dryrun_commerce_session='))?.slice('dryrun_commerce_session='.length);
      const scope = cookie && /^[a-f0-9-]{36}$/.test(cookie) ? cookie : randomUUID();
      if (scope !== cookie) res.setHeader('Set-Cookie', `dryrun_commerce_session=${scope}; HttpOnly; SameSite=Strict; Path=/api/commerce${req.secure ? '; Secure' : ''}`);
      res.json(await services.checkout(req.body, scope));
    } catch (error) {
      if (error instanceof CommerceError) {
        return void res.status(error.status).json({ error: error.message, code: error.code, refreshedListings: error.refreshedListings });
      }
      // Provider errors can contain token-bearing URLs. Never log or return them.
      res.status(502).json({ error: 'Checkout could not be confirmed. No payment was made by this app.', code: 'CHECKOUT_UNKNOWN' });
    }
  });
  return router;
}

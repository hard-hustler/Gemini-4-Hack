import express from 'express';
import type { Server } from 'node:http';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { commerceRoutes } from './commerce-routes';
import { CommerceError } from './commerce';

let server: Server;
let base: string;
const search = vi.fn();
const product = vi.fn();
const checkout = vi.fn();
beforeEach(async () => {
  vi.resetAllMocks();
  const app = express();
  app.use(express.json());
  app.use(commerceRoutes({ search, product, checkout }));
  server = await new Promise<Server>((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', (error?: Error) => error ? reject(error) : resolve(listening));
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => {
  if (!server?.listening) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});

test('catalog rejects malformed or oversized search and trims a valid query', async () => {
  for (const query of [null, {}, '', ' '.repeat(5), 'x'.repeat(301)]) {
    expect((await post('/api/catalog/search', { query })).status).toBe(400);
  }
  expect(search).not.toHaveBeenCalled();
  search.mockResolvedValue([{ title: 'Live listing' }]);
  const response = await post('/api/catalog/search', { query: ' workbench ' });
  expect(response.status).toBe(200);
  expect(search).toHaveBeenCalledWith('workbench');
  expect(await response.json()).toEqual({ listings: [{ title: 'Live listing' }] });
});

test('variant selections cross the existing catalog boundary unchanged', async () => {
  expect((await post('/api/catalog/product', { id: 'p', selected: [{}] })).status).toBe(400);
  product.mockResolvedValue([]);
  const selected = [{ name: 'Size', label: '48 inch' }];
  expect((await post('/api/catalog/product', { id: 'p', selected })).status).toBe(200);
  expect(product).toHaveBeenCalledWith('p', selected);
});

test('checkout rejects cross-origin creation before calling Shop', async () => {
  expect((await post('/api/commerce/checkout', { approved: true }, { Origin: 'https://unrelated.example' })).status).toBe(403);
  expect(checkout).not.toHaveBeenCalled();
});

test('checkout responses are private and never imply a payment', async () => {
  const result = { id: 'private-id', shop: 'merchant.myshopify.com', checkoutUrl: 'https://merchant.myshopify.com/checkouts/private', status: 'checkout_created', paymentStatus: 'unverified' };
  checkout.mockResolvedValue(result);
  const response = await post('/api/commerce/checkout', { approved: true }, { Origin: base });
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(await response.json()).toEqual(result);
});

test('unknown provider errors never expose token-bearing checkout URLs', async () => {
  checkout.mockRejectedValue(new Error('https://merchant.myshopify.com/checkouts/SECRET_ACCESS_KEY'));
  const response = await post('/api/commerce/checkout', { approved: true });
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain('SECRET_ACCESS_KEY');
});

test('approval failures stay actionable without enabling a payment endpoint', async () => {
  checkout.mockRejectedValue(new CommerceError('Review the updated price.', 409, 'APPROVAL_REQUIRED'));
  const response = await post('/api/commerce/checkout', {});
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: 'APPROVAL_REQUIRED' });
  expect((await post('/api/commerce/complete', {})).status).toBe(404);
  expect((await post('/api/commerce/pay', {})).status).toBe(404);
});

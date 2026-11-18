import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { generateSesame, xofToMsat } from '@sesame/core';
import { createServerContext, type ServerContext } from '../src/context.js';
import { buildApp } from '../src/app.js';

const RATE = 60_000_000;
let ctx: ServerContext;
let app: FastifyInstance;
beforeEach(async () => {
  ctx = createServerContext({ mode: 'simulation', fixedXofPerBtc: RATE });
  app = buildApp(ctx);
  await app.ready();
});
afterEach(async () => { await app.close(); });

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function seller() {
  return (await app.inject({ method: 'POST', url: '/api/shops', payload: { name: 'Boutique', city: 'Dakar', pin: '4821' } })).json() as { sellerToken: string };
}

async function deliverWithCourier(sellerToken: string, payload: Record<string, unknown>) {
  const c = await app.inject({ method: 'POST', url: '/api/orders', headers: auth(sellerToken), payload });
  expect(c.statusCode).toBe(201);
  const { order, clientToken } = c.json() as { order: { id: string }; clientToken: string };
  const s = generateSesame();
  await app.inject({ method: 'POST', url: `/api/orders/${order.id}/lock`, headers: auth(clientToken), payload: { paymentHash: s.paymentHash } });
  await app.inject({ method: 'POST', url: `/api/demo/pay/${order.id}`, headers: auth(clientToken), payload: {} });
  const a = (await app.inject({ method: 'POST', url: `/api/orders/${order.id}/assign`, headers: auth(sellerToken), payload: { lightningAddress: 'moussa@wos.example.com' } })).json() as { courierToken: string; order: { netXof: number; courierFeeXof: number } };
  const courierView = (await app.inject({ method: 'GET', url: `/api/orders/${order.id}`, headers: auth(a.courierToken) })).json() as { courierFeeXof: number };
  await app.inject({ method: 'POST', url: `/api/orders/${order.id}/release`, headers: auth(clientToken), payload: { preimage: s.preimage } });
  return { stored: (await ctx.store.get(order.id))!, sellerView: a.order, courierView };
}

describe('Part du livreur', () => {
  it('par défaut, le livreur reçoit exactement les frais de livraison payés par le client', async () => {
    const s = await seller();
    const r = await deliverWithCourier(s.sellerToken, { itemLabel: 'Sac', itemXof: 10_000, deliveryFeeXof: 1_500, deliveryHours: 6 });
    expect(r.courierView.courierFeeXof).toBe(1_500);
    expect(r.stored.payouts.find((p) => p.kind === 'courier')?.amountMsat).toBe(xofToMsat(1_500, RATE));
    expect(r.sellerView.netXof).toBe(10_000 - 100); // article − 1 % ; la livraison va au livreur
  });

  it('livraison offerte : le client ne paie pas la livraison, la vendeuse paie le livreur sur sa part', async () => {
    const s = await seller();
    const r = await deliverWithCourier(s.sellerToken, { itemLabel: 'Sac', itemXof: 10_000, deliveryFeeXof: 0, courierFeeXof: 1_000, deliveryHours: 6 });
    expect(r.courierView.courierFeeXof).toBe(1_000);
    expect(r.stored.payouts.find((p) => p.kind === 'courier')?.amountMsat).toBe(xofToMsat(1_000, RATE));
    expect(r.sellerView.netXof).toBe(10_000 - 1_000 - 100);
  });

  it('la vendeuse ne peut jamais garder une partie des frais de livraison', async () => {
    const s = await seller();
    const r = await app.inject({
      method: 'POST', url: '/api/orders', headers: auth(s.sellerToken),
      payload: { itemLabel: 'Sac', itemXof: 10_000, deliveryFeeXof: 1_500, courierFeeXof: 1_000, deliveryHours: 6 },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ error: 'INVALID_COURIER_FEE' });
  });

  it('la part du livreur ne peut pas dépasser ce qui revient à la vendeuse', async () => {
    const s = await seller();
    const r = await app.inject({
      method: 'POST', url: '/api/orders', headers: auth(s.sellerToken),
      payload: { itemLabel: 'Sac', itemXof: 1_000, deliveryFeeXof: 0, courierFeeXof: 5_000, deliveryHours: 6 },
    });
    expect(r.json()).toMatchObject({ error: 'INVALID_COURIER_FEE' });
  });
});

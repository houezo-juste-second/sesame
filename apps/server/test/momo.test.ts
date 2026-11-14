import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { generateSesame } from '@sesame/core';
import { createServerContext, type ServerContext } from '../src/context.js';
import { buildApp } from '../src/app.js';

let ctx: ServerContext;
let app: FastifyInstance;

beforeEach(async () => {
  ctx = createServerContext({ mode: 'simulation', fixedXofPerBtc: 60_000_000 });
  app = buildApp(ctx);
  await app.ready();
});
afterEach(async () => {
  await app.close();
});

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function shop() {
  return (await app.inject({ method: 'POST', url: '/api/shops', payload: { name: 'Pagnes de Fifamè', city: 'Cotonou', pin: '4821' } })).json() as {
    shopId: string; sellerToken: string;
  };
}

async function order(sellerToken: string) {
  return (await app.inject({
    method: 'POST', url: '/api/orders', headers: auth(sellerToken),
    payload: { itemLabel: '2 pagnes wax', itemXof: 18_000, deliveryFeeXof: 1_500, deliveryHours: 6 },
  })).json() as { order: { id: string; sellerPayoutLabel: string | null }; clientToken: string };
}

describe('Versement de la vendeuse', () => {
  it('enregistre un compte Mobile Money chiffré, sans jamais renvoyer le numéro complet', async () => {
    const s = await shop();
    const r = await app.inject({
      method: 'POST', url: '/api/shops/me/payout', headers: auth(s.sellerToken),
      payload: { method: 'momo', operator: 'MTN MoMo', phone: '+229 97 00 00 42' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ method: 'momo', operator: 'MTN MoMo', phoneHint: '42', label: 'MTN MoMo •• 42' });
    expect(r.body).not.toContain('97000042');

    const raw = ctx.db.prepare('SELECT payout FROM shops WHERE id = ?').get(s.shopId) as { payout: string };
    expect(raw.payout).not.toContain('97000042'); // chiffré au repos

    const dash = (await app.inject({ method: 'GET', url: '/api/shops/me/orders', headers: auth(s.sellerToken) })).json() as { shop: { payoutLabel: string } };
    expect(dash.shop.payoutLabel).toBe('MTN MoMo •• 42');
  });

  it('refuse un opérateur inconnu ou un numéro invalide', async () => {
    const s = await shop();
    const bad1 = await app.inject({ method: 'POST', url: '/api/shops/me/payout', headers: auth(s.sellerToken), payload: { method: 'momo', operator: 'Banque X', phone: '97000042' } });
    const bad2 = await app.inject({ method: 'POST', url: '/api/shops/me/payout', headers: auth(s.sellerToken), payload: { method: 'momo', operator: 'Wave', phone: '12' } });
    expect(bad1.statusCode).toBe(400);
    expect(bad2.statusCode).toBe(400);
  });

  it('accepte une adresse Lightning', async () => {
    const s = await shop();
    const r = await app.inject({ method: 'POST', url: '/api/shops/me/payout', headers: auth(s.sellerToken), payload: { method: 'lightning', address: 'Fifame@Blink.sv' } });
    expect(r.json()).toMatchObject({ method: 'lightning', address: 'fifame@blink.sv' });
  });
});

describe('Paiement Mobile Money (partenaire simulé)', () => {
  it('le client paie en Mobile Money, l\'argent est bloqué, puis la vendeuse est versée sur son Mobile Money', async () => {
    const s = await shop();
    await app.inject({ method: 'POST', url: '/api/shops/me/payout', headers: auth(s.sellerToken), payload: { method: 'momo', operator: 'Wave', phone: '770000017' } });
    const o = await order(s.sellerToken);
    expect(o.order.sellerPayoutLabel).toBe('Wave •• 17');

    const sesame = generateSesame();
    await app.inject({ method: 'POST', url: `/api/orders/${o.order.id}/lock`, headers: auth(o.clientToken), payload: { paymentHash: sesame.paymentHash } });
    const paid = await app.inject({ method: 'POST', url: `/api/orders/${o.order.id}/pay/momo`, headers: auth(o.clientToken), payload: { operator: 'MTN MoMo', phone: '97 11 22 33' } });
    expect(paid.statusCode).toBe(200);
    expect(paid.json()).toMatchObject({ state: 'FUNDS_LOCKED', payment: { method: 'momo', operator: 'MTN MoMo', phoneHint: '33' } });
    expect(paid.body).not.toContain('97112233');

    await app.inject({ method: 'POST', url: `/api/orders/${o.order.id}/release`, headers: auth(o.clientToken), payload: { preimage: sesame.preimage } });
    const stored = await ctx.store.get(o.order.id);
    const seller = stored!.payouts.find((p) => p.kind === 'seller');
    expect(stored!.state).toBe('RELEASED');
    expect(seller).toMatchObject({ destination: 'momo:Wave:17', status: 'sent' });
    // Sans livreur assigné : la vendeuse reçoit tout moins les frais (19 500 − 180 FCFA, au taux fixe).
    expect(seller!.amountMsat).toBe(stored!.amountMsat - stored!.feeMsat);
  });

  it('sans compte de versement, les sats restent dans le wallet de la vendeuse (pas de versement « seller »)', async () => {
    const s = await shop();
    const o = await order(s.sellerToken);
    const sesame = generateSesame();
    await app.inject({ method: 'POST', url: `/api/orders/${o.order.id}/lock`, headers: auth(o.clientToken), payload: { paymentHash: sesame.paymentHash } });
    await app.inject({ method: 'POST', url: `/api/demo/pay/${o.order.id}`, headers: auth(o.clientToken), payload: {} });
    await app.inject({ method: 'POST', url: `/api/orders/${o.order.id}/release`, headers: auth(o.clientToken), payload: { preimage: sesame.preimage } });
    const stored = await ctx.store.get(o.order.id);
    expect(stored!.payouts.some((p) => p.kind === 'seller')).toBe(false);
    expect(stored!.payment).toEqual({ method: 'lightning' });
  });

  it('refuse le paiement Mobile Money avant la création de la facture, ou par le livreur', async () => {
    const s = await shop();
    const o = await order(s.sellerToken);
    const early = await app.inject({ method: 'POST', url: `/api/orders/${o.order.id}/pay/momo`, headers: auth(o.clientToken), payload: { operator: 'Wave', phone: '770000017' } });
    expect(early.statusCode).toBe(409);
    const bySeller = await app.inject({ method: 'POST', url: `/api/orders/${o.order.id}/pay/momo`, headers: auth(s.sellerToken), payload: { operator: 'Wave', phone: '770000017' } });
    expect(bySeller.statusCode).toBe(403);
  });
});

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

async function newShop() {
  const r = await app.inject({ method: 'POST', url: '/api/shops', payload: { name: 'Pagnes de Fifamè', city: 'Cotonou', pin: '4821' } });
  expect(r.statusCode).toBe(201);
  return r.json() as { shopId: string; slug: string; sellerToken: string };
}

async function newOrder(sellerToken: string) {
  const r = await app.inject({
    method: 'POST', url: '/api/orders', headers: auth(sellerToken),
    payload: { itemLabel: '2 pagnes wax', itemXof: 18_000, deliveryFeeXof: 1_500, deliveryHours: 6 },
  });
  expect(r.statusCode).toBe(201);
  return r.json() as { order: { id: string; totalXof: number; state: string }; clientToken: string };
}

describe('API — parcours complet', () => {
  it('vendeuse → client → livreur : la commande est libérée et payée', async () => {
    const shop = await newShop();
    const { order, clientToken } = await newOrder(shop.sellerToken);
    expect(order.totalXof).toBe(19_500);
    expect(order.state).toBe('DRAFT');

    // Le client ouvre le lien
    const view = await app.inject({ method: 'GET', url: `/api/orders/${order.id}`, headers: auth(clientToken) });
    expect(view.statusCode).toBe(200);
    expect(view.json().shopName).toBe('Pagnes de Fifamè');

    // Le client verrouille avec H uniquement
    const s = generateSesame();
    const lock = await app.inject({
      method: 'POST', url: `/api/orders/${order.id}/lock`, headers: auth(clientToken), payload: { paymentHash: s.paymentHash },
    });
    expect(lock.statusCode).toBe(200);
    expect(lock.json().bolt11).toMatch(/^lnbcrt/);
    expect(lock.json().amountSat).toBe('32500');

    // Paiement (wallet de démo, mode simulation)
    const pay = await app.inject({ method: 'POST', url: `/api/demo/pay/${order.id}`, headers: auth(clientToken) });
    expect(pay.statusCode).toBe(200);
    expect(pay.json().state).toBe('FUNDS_LOCKED');

    // La vendeuse assigne le livreur
    const assign = await app.inject({
      method: 'POST', url: `/api/orders/${order.id}/assign`, headers: auth(shop.sellerToken),
      payload: { lightningAddress: 'moussa@walletofsatoshi.com' },
    });
    expect(assign.statusCode).toBe(200);
    const { courierToken } = assign.json() as { courierToken: string };

    // Le livreur scanne le sésame
    const release = await app.inject({
      method: 'POST', url: `/api/orders/${order.id}/release`, headers: auth(courierToken), payload: { preimage: s.preimage },
    });
    expect(release.statusCode).toBe(200);
    expect(release.json().state).toBe('RELEASED');

    // La vendeuse voit la commande payée dans son tableau de bord
    const list = await app.inject({ method: 'GET', url: '/api/shops/me/orders', headers: auth(shop.sellerToken) });
    expect(list.json().orders[0].state).toBe('RELEASED');
    expect(list.json().summary.releasedXof).toBe(17_820);
  });
});

describe('API — contrôle d’accès et validation', () => {
  it('refuse un jeton absent ou faux', async () => {
    const shop = await newShop();
    const { order } = await newOrder(shop.sellerToken);
    expect((await app.inject({ method: 'GET', url: `/api/orders/${order.id}` })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/api/orders/${order.id}`, headers: auth('faux') })).statusCode).toBe(401);
  });

  it('le jeton d’une commande ne donne pas accès à une autre', async () => {
    const shop = await newShop();
    const a = await newOrder(shop.sellerToken);
    const b = await newOrder(shop.sellerToken);
    const r = await app.inject({ method: 'GET', url: `/api/orders/${b.order.id}`, headers: auth(a.clientToken) });
    expect(r.statusCode).toBe(403);
  });

  it('le client ne peut ni assigner ni annuler ; la vendeuse ne peut pas verrouiller', async () => {
    const shop = await newShop();
    const { order, clientToken } = await newOrder(shop.sellerToken);
    expect((await app.inject({ method: 'POST', url: `/api/orders/${order.id}/cancel`, headers: auth(clientToken) })).statusCode).toBe(403);
    const lock = await app.inject({
      method: 'POST', url: `/api/orders/${order.id}/lock`, headers: auth(shop.sellerToken),
      payload: { paymentHash: generateSesame().paymentHash },
    });
    expect(lock.statusCode).toBe(403);
  });

  it('valide les entrées et répond en français', async () => {
    const shop = await newShop();
    const r = await app.inject({
      method: 'POST', url: '/api/orders', headers: auth(shop.sellerToken),
      payload: { itemLabel: '', itemXof: -3, deliveryFeeXof: 0, deliveryHours: 6 },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().message).toMatch(/invalides/);
  });

  it('mauvais sésame → 422 ; trop d’essais → 429', async () => {
    const shop = await newShop();
    const { order, clientToken } = await newOrder(shop.sellerToken);
    const s = generateSesame();
    await app.inject({ method: 'POST', url: `/api/orders/${order.id}/lock`, headers: auth(clientToken), payload: { paymentHash: s.paymentHash } });
    await app.inject({ method: 'POST', url: `/api/demo/pay/${order.id}`, headers: auth(clientToken) });
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await app.inject({
        method: 'POST', url: `/api/orders/${order.id}/release`, headers: auth(clientToken),
        payload: { preimage: generateSesame().preimage },
      });
      codes.push(r.statusCode);
    }
    expect(codes.slice(0, 5)).toEqual([422, 422, 422, 422, 422]);
    expect(codes[5]).toBe(429);
  });

  it('connexion vendeuse par code PIN', async () => {
    const shop = await newShop();
    const bad = await app.inject({ method: 'POST', url: '/api/shops/login', payload: { slug: shop.slug, pin: '0000' } });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({ method: 'POST', url: '/api/shops/login', payload: { slug: shop.slug, pin: '4821' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().sellerToken).toBeTruthy();
  });

  it('extraction de commande par l’IA (heuristique gratuite)', async () => {
    const shop = await newShop();
    const r = await app.inject({
      method: 'POST', url: '/api/ai/extract-order', headers: auth(shop.sellerToken),
      payload: { text: 'je prends les 2 pagnes à 18 000, livraison à Fidjrossè 1 500' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ amountXof: 18_000, deliveryFeeXof: 1_500, source: 'heuristic' });
  });

  it('expose le taux et l’état de santé', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/rate' })).json().xofPerBtc).toBe(60_000_000);
    const h = await app.inject({ method: 'GET', url: '/healthz' });
    expect(h.json()).toMatchObject({ ok: true, mode: 'simulation' });
  });
});

describe('API — reçus Nostr vérifiables', () => {
  it('une livraison produit un reçu signé, vérifiable sans faire confiance au serveur', async () => {
    const { checkReceipt } = await import('@sesame/core');
    const shop = await newShop();
    const { order, clientToken } = await newOrder(shop.sellerToken);
    const s = generateSesame();
    await app.inject({ method: 'POST', url: `/api/orders/${order.id}/lock`, headers: auth(clientToken), payload: { paymentHash: s.paymentHash } });
    await app.inject({ method: 'POST', url: `/api/demo/pay/${order.id}`, headers: auth(clientToken) });
    await app.inject({ method: 'POST', url: `/api/orders/${order.id}/release`, headers: auth(clientToken), payload: { preimage: s.preimage } });
    await ctx.receipts.idle();

    const r = await app.inject({ method: 'GET', url: `/api/shops/${shop.slug}/receipts` });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { pubkey: string; npub: string; events: Array<{ pubkey: string }> };
    expect(body.npub).toMatch(/^npub1/);
    expect(body.events).toHaveLength(1);
    expect(body.events[0]!.pubkey).toBe(body.pubkey);
    expect(checkReceipt(body.events[0] as never)).toEqual({ valid: true, outcome: 'released', proofOfPayment: true });
    expect(JSON.stringify(body)).not.toContain('2 pagnes wax');
  });

  it('publie sur les relais quand un publieur est configuré', async () => {
    const published: string[] = [];
    const c2 = createServerContext({
      mode: 'simulation', fixedXofPerBtc: 60_000_000,
      publisher: { publish: async (ev) => { published.push(ev.id); return 2; } },
    });
    const a2 = buildApp(c2);
    const sh = (await a2.inject({ method: 'POST', url: '/api/shops', payload: { name: 'Test', city: 'Dakar', pin: '1234' } })).json();
    const o = (await a2.inject({ method: 'POST', url: '/api/orders', headers: auth(sh.sellerToken), payload: { itemLabel: 'x', itemXof: 1000, deliveryFeeXof: 0, deliveryHours: 6 } })).json();
    const s = generateSesame();
    await a2.inject({ method: 'POST', url: `/api/orders/${o.order.id}/lock`, headers: auth(o.clientToken), payload: { paymentHash: s.paymentHash } });
    await a2.inject({ method: 'POST', url: `/api/demo/pay/${o.order.id}`, headers: auth(o.clientToken) });
    await a2.inject({ method: 'POST', url: `/api/orders/${o.order.id}/cancel`, headers: auth(sh.sellerToken) });
    await c2.receipts.idle();
    expect(published).toHaveLength(1);
    expect(c2.db.prepare('SELECT relays_ok FROM nostr_events').get()).toEqual({ relays_ok: 2 });
    await a2.close();
  });
});

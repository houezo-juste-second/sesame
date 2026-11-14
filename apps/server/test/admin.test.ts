import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { generateSesame } from '@sesame/core';
import { createServerContext, type ServerContext } from '../src/context.js';
import { buildApp } from '../src/app.js';
import { AdminSessions } from '../src/admin.js';

const CODE = 'code-admin-2026';
let ctx: ServerContext;
let app: FastifyInstance;

beforeEach(async () => {
  ctx = createServerContext({ mode: 'simulation', fixedXofPerBtc: 60_000_000, adminCode: CODE });
  app = buildApp(ctx);
  await app.ready();
});
afterEach(async () => {
  await app.close();
});

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function adminToken() {
  const r = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { code: CODE } });
  expect(r.statusCode).toBe(200);
  return (r.json() as { adminToken: string }).adminToken;
}

async function shopWithOrder() {
  const s = (await app.inject({ method: 'POST', url: '/api/shops', payload: { name: 'Boutique Awa', city: 'Dakar', pin: '4821' } })).json() as {
    shopId: string; slug: string; sellerToken: string;
  };
  const o = (await app.inject({
    method: 'POST', url: '/api/orders', headers: auth(s.sellerToken),
    payload: { itemLabel: 'Robe', itemXof: 20_000, deliveryFeeXof: 1_000, deliveryHours: 6 },
  })).json() as { order: { id: string }; clientToken: string };
  return { ...s, orderId: o.order.id, clientToken: o.clientToken };
}

async function deliver(orderId: string, clientToken: string) {
  const s = generateSesame();
  await app.inject({ method: 'POST', url: `/api/orders/${orderId}/lock`, headers: auth(clientToken), payload: { paymentHash: s.paymentHash } });
  await app.inject({ method: 'POST', url: `/api/demo/pay/${orderId}`, headers: auth(clientToken), payload: {} });
  const r = await app.inject({ method: 'POST', url: `/api/orders/${orderId}/release`, headers: auth(clientToken), payload: { preimage: s.preimage } });
  expect(r.statusCode).toBe(200);
}

describe('Administration', () => {
  it('désactivée sans code configuré (404)', async () => {
    const c2 = createServerContext({ mode: 'simulation', fixedXofPerBtc: 60_000_000 });
    const a2 = buildApp(c2);
    const r = await a2.inject({ method: 'POST', url: '/api/admin/login', payload: { code: 'nimporte' } });
    expect(r.statusCode).toBe(404);
    expect((await a2.inject({ method: 'GET', url: '/api/admin/overview' })).statusCode).toBe(404);
    await a2.close();
  });

  it('refuse un mauvais code, une session absente ou un jeton de vendeuse', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/admin/login', payload: { code: 'mauvais' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/admin/overview' })).statusCode).toBe(401);
    const s = await shopWithOrder();
    expect((await app.inject({ method: 'GET', url: '/api/admin/overview', headers: auth(s.sellerToken) })).statusCode).toBe(401);
  });

  it('limite les essais de connexion', async () => {
    for (let i = 0; i < 5; i++) await app.inject({ method: 'POST', url: '/api/admin/login', payload: { code: 'x' } });
    expect((await app.inject({ method: 'POST', url: '/api/admin/login', payload: { code: CODE } })).statusCode).toBe(429);
  });

  it('vue d\'ensemble : chiffres, frais, alertes, sans aucun secret', async () => {
    const s = await shopWithOrder();
    await deliver(s.orderId, s.clientToken);
    await shopWithOrder(); // une commande restée en brouillon
    const r = await app.inject({ method: 'GET', url: '/api/admin/overview', headers: auth(await adminToken()) });
    expect(r.statusCode).toBe(200);
    const o = r.json() as {
      totals: { shops: number; orders: number; releasedXof: number; feesXof: number; successRate: number };
      byState: Record<string, number>; alerts: { auditChainOk: boolean; overdue: number }; shops: Array<{ slug: string; released: number }>;
    };
    expect(o.totals).toMatchObject({ shops: 2, orders: 2, releasedXof: 21_000, feesXof: 200, successRate: 100 });
    expect(o.byState).toMatchObject({ RELEASED: 1, DRAFT: 1 });
    expect(o.alerts).toMatchObject({ auditChainOk: true, overdue: 0 });
    expect(o.shops.find((x) => x.slug === s.slug)?.released).toBe(1);
    expect(r.body).not.toMatch(/preimage|pinHash|pin_hash|nostr_seckey|sellerToken/i);
  });

  it('détecte un journal d\'audit modifié', async () => {
    const s = await shopWithOrder();
    await deliver(s.orderId, s.clientToken);
    ctx.db.prepare("UPDATE audit_log SET payload = '{\"state\":\"REFUNDED\"}' WHERE seq = 2").run();
    const o = (await app.inject({ method: 'GET', url: '/api/admin/overview', headers: auth(await adminToken()) })).json() as {
      alerts: { auditChainOk: boolean; auditBrokenAt: number };
    };
    expect(o.alerts).toMatchObject({ auditChainOk: false, auditBrokenAt: 2 });
  });

  it('suspendre une boutique bloque connexion, nouvelles commandes et paiement ; le remboursement reste possible', async () => {
    const s = await shopWithOrder();
    const token = await adminToken();
    const r = await app.inject({ method: 'POST', url: `/api/admin/shops/${s.shopId}/suspend`, headers: auth(token), payload: { suspended: true } });
    expect(r.statusCode).toBe(200);

    const login = await app.inject({ method: 'POST', url: '/api/shops/login', payload: { slug: s.slug, pin: '4821' } });
    expect(login.statusCode).toBe(403);
    expect(login.json()).toMatchObject({ error: 'SHOP_SUSPENDED' });

    const create = await app.inject({
      method: 'POST', url: '/api/orders', headers: auth(s.sellerToken),
      payload: { itemLabel: 'Sac', itemXof: 5_000, deliveryFeeXof: 0, deliveryHours: 6 },
    });
    expect(create.statusCode).toBe(403);

    const lock = await app.inject({ method: 'POST', url: `/api/orders/${s.orderId}/lock`, headers: auth(s.clientToken), payload: { paymentHash: generateSesame().paymentHash } });
    expect(lock.statusCode).toBe(403);

    // La vendeuse peut encore consulter et annuler (rembourser).
    expect((await app.inject({ method: 'GET', url: '/api/shops/me/orders', headers: auth(s.sellerToken) })).statusCode).toBe(200);

    // Réactivation, tracée dans le journal d'audit.
    await app.inject({ method: 'POST', url: `/api/admin/shops/${s.shopId}/suspend`, headers: auth(token), payload: { suspended: false } });
    expect((await app.inject({ method: 'POST', url: '/api/shops/login', payload: { slug: s.slug, pin: '4821' } })).statusCode).toBe(200);
    expect(ctx.audit.entries().map((e) => e.event)).toEqual(expect.arrayContaining(['SHOP_SUSPENDED', 'SHOP_REINSTATED']));
  });

  it('les sessions expirent après 12 h', () => {
    let now = 0;
    const sessions = new AdminSessions('code-admin-2026', () => now);
    const t = sessions.login('code-admin-2026')!;
    expect(sessions.check(t)).toBe(true);
    now = 12 * 60 * 60 * 1000 + 1;
    expect(sessions.check(t)).toBe(false);
    expect(sessions.login('autre-code')).toBeUndefined();
  });
});

describe('Démo guidée', () => {
  it('crée une boutique de démo jetable avec une commande, comptée à part', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/demo/start' });
    expect(r.statusCode).toBe(201);
    const d = r.json() as { slug: string; orderId: string; sellerToken: string; clientToken: string };
    expect(d.slug).toMatch(/^pagnes-de-fifame-demo/);

    const order = (await app.inject({ method: 'GET', url: `/api/orders/${d.orderId}`, headers: auth(d.clientToken) })).json() as { totalXof: number; state: string };
    expect(order).toMatchObject({ totalXof: 19_500, state: 'DRAFT' });

    const dash = (await app.inject({ method: 'GET', url: '/api/shops/me/orders', headers: auth(d.sellerToken) })).json() as { shop: { demo: boolean } };
    expect(dash.shop.demo).toBe(true);

    const o = (await app.inject({ method: 'GET', url: '/api/admin/overview', headers: auth(await adminToken()) })).json() as {
      totals: { shops: number; demoShops: number; orders: number; demoOrders: number };
    };
    expect(o.totals).toMatchObject({ shops: 0, demoShops: 1, orders: 0, demoOrders: 1 });
  });

  it('deux visiteurs ont deux boutiques séparées', async () => {
    const a = (await app.inject({ method: 'POST', url: '/api/demo/start' })).json() as { orderId: string; sellerToken: string };
    const b = (await app.inject({ method: 'POST', url: '/api/demo/start' })).json() as { orderId: string };
    const r = await app.inject({ method: 'GET', url: `/api/orders/${b.orderId}`, headers: auth(a.sellerToken) });
    expect(r.statusCode).toBe(403);
  });
});

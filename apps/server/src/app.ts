/**
 * API HTTP de Sésame (cahier des charges §11).
 * Toutes les entrées sont validées par Zod ; toutes les erreurs ont un message en français.
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import * as nip19 from 'nostr-tools/nip19';
import { STATE_LABEL_FR } from '@sesame/core';
import { bearer, hashPin, verifyPin, type Grant, type Role } from './auth.js';
import { extractOrder, MAX_INPUT_CHARS } from './ai/extract.js';
import { EscrowError, type EngineEvent, type EscrowErrorCode } from './escrow/engine.js';
import type { Order } from './escrow/types.js';
import type { ServerContext } from './context.js';
import type { Shop } from './shops.js';

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

const STATUS: Partial<Record<EscrowErrorCode, number>> = {
  ORDER_NOT_FOUND: 404,
  PREIMAGE_MISMATCH: 422,
  ORDER_NOT_LOCKABLE: 409,
  ORDER_NOT_RELEASABLE: 409,
  ORDER_NOT_CANCELLABLE: 409,
  ORDER_NOT_ASSIGNABLE: 409,
  PAYMENT_HASH_REUSED: 409,
  DEADLINE_PASSED: 409,
  SETTLE_PENDING: 202,
};

const SSE_MAX_MS = 60_000;

/** Limiteur simple à fenêtre glissante (mémoire). */
class Limiter {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly max: number, private readonly windowMs: number) {}
  take(key: string): boolean {
    const now = Date.now();
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length >= this.max) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    return true;
  }
}

const ShopInput = z.object({
  name: z.string().trim().min(2).max(60),
  city: z.string().trim().min(2).max(40),
  pin: z.string().regex(/^\d{4,6}$/),
});
const LoginInput = z.object({ slug: z.string().min(1).max(60), pin: z.string().regex(/^\d{4,6}$/) });
const OrderInput = z.object({
  itemLabel: z.string().trim().min(1).max(120),
  itemXof: z.number().int().min(1).max(5_000_000),
  deliveryFeeXof: z.number().int().min(0).max(1_000_000),
  deliveryHours: z.number().int().min(2).max(12),
});
const LockInput = z.object({ paymentHash: z.string().regex(/^[0-9a-fA-F]{64}$/) });
const ReleaseInput = z.object({ preimage: z.string().regex(/^[0-9a-fA-F]{64}$/) });
const AssignInput = z.object({ lightningAddress: z.string().trim().min(3).max(320) });
const ExtractInput = z.object({ text: z.string().min(1).max(MAX_INPUT_CHARS) });
const IdParam = z.object({ id: z.string().uuid() });

export function buildApp(ctx: ServerContext, opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({
    logger: opts.logger
      ? {
          redact: ['req.headers.authorization'],
          // Jamais de jeton ni de paramètre de requête dans les journaux.
          serializers: { req: (r) => ({ method: r.method, url: r.url.split('?')[0] ?? '/' }) },
        }
      : false,
    bodyLimit: 16 * 1024,
  });
  const releaseLimiter = new Limiter(5, 60_000);
  const loginLimiter = new Limiter(5, 60_000);

  // ---------------------------------------------------------------- utilitaires

  function grantOf(req: FastifyRequest): Grant {
    const grant = ctx.tokens.resolve(bearer(req.headers.authorization));
    if (!grant) throw new HttpError(401, 'UNAUTHORIZED', 'Lien invalide ou expiré.');
    return grant;
  }

  async function orderFor(req: FastifyRequest, roles: Role[]): Promise<{ grant: Grant; order: Order; shop: Shop }> {
    const grant = grantOf(req);
    const { id } = IdParam.parse(req.params);
    if (!roles.includes(grant.role)) throw new HttpError(403, 'FORBIDDEN', "Cette action n'est pas autorisée pour vous.");
    const order = await ctx.store.get(id);
    if (!order) throw new EscrowError('ORDER_NOT_FOUND');
    const allowed = grant.role === 'seller' ? order.shopId === grant.shopId : grant.orderId === order.id;
    if (!allowed) throw new HttpError(403, 'FORBIDDEN', "Cette commande n'est pas accessible avec ce lien.");
    const shop = ctx.shops.get(order.shopId);
    if (!shop) throw new EscrowError('ORDER_NOT_FOUND');
    return { grant, order, shop };
  }

  function sellerShop(req: FastifyRequest): Shop {
    const grant = grantOf(req);
    if (grant.role !== 'seller') throw new HttpError(403, 'FORBIDDEN', 'Réservé à la vendeuse.');
    const shop = ctx.shops.get(grant.shopId);
    if (!shop) throw new HttpError(401, 'UNAUTHORIZED', 'Boutique introuvable.');
    return shop;
  }

  async function reputation(shopId: string) {
    const orders = await ctx.store.listByShop(shopId);
    return {
      released: orders.filter((o) => o.state === 'RELEASED').length,
      refunded: orders.filter((o) => o.state === 'REFUNDED').length,
    };
  }

  function netXof(o: Order): number {
    return o.itemXof + o.deliveryFeeXof - (o.courierAddress ? o.deliveryFeeXof : 0) - o.feeXof;
  }

  function view(o: Order, shop: Shop, role: Role) {
    const base = {
      id: o.id,
      shopName: shop.name,
      shopSlug: shop.slug,
      shopCity: shop.city,
      itemLabel: o.itemLabel,
      itemXof: o.itemXof,
      deliveryFeeXof: o.deliveryFeeXof,
      totalXof: o.itemXof + o.deliveryFeeXof,
      amountSat: (o.amountMsat / 1000n).toString(),
      deliveryHours: o.deliveryHours,
      state: o.state,
      stateLabel: STATE_LABEL_FR[o.state],
      invoiceExpiresAt: o.invoiceExpiresAt ?? null,
      releaseDeadlineAt: o.releaseDeadlineAt ?? null,
      courierAssigned: Boolean(o.courierAddress),
      createdAt: o.createdAt,
      simulation: ctx.config.mode === 'simulation',
    };
    if (role === 'client') return { ...base, bolt11: o.state === 'AWAITING_PAYMENT' ? o.bolt11 ?? null : null };
    if (role === 'courier') return { ...base, courierFeeXof: o.deliveryFeeXof };
    return {
      ...base,
      courierAddress: o.courierAddress ?? null,
      feeXof: o.feeXof,
      netXof: netXof(o),
      payouts: o.payouts.map((p) => ({ kind: p.kind, status: p.status })),
    };
  }

  function sse(req: FastifyRequest, reply: FastifyReply, subscribe: (fn: (e: EngineEvent) => void) => () => void, first: unknown) {
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (data: unknown) => raw.write(`data: ${JSON.stringify(data)}\n\n`);
    send({ type: 'SNAPSHOT', snapshot: first });
    const unsubscribe = subscribe((e) => send({ type: e.type, orderId: e.orderId, state: e.state, stateLabel: STATE_LABEL_FR[e.state], at: e.at }));
    const ping = setInterval(() => raw.write(': ping\n\n'), 25_000);
    // Recyclage : le flux est fermé au bout d'une minute, le client se reconnecte.
    // Une connexion orpheline (page quittée, réseau mobile coupé) ne bloque donc jamais longtemps.
    const recycle = setTimeout(() => raw.end(), SSE_MAX_MS);
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      clearTimeout(recycle);
      unsubscribe();
    };
    req.raw.on('close', cleanup);
    raw.on('close', cleanup);
  }

  // ---------------------------------------------------------------- erreurs

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof EscrowError) {
      return reply.status(STATUS[err.code] ?? 400).send({ error: err.code, message: err.message });
    }
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.code, message: err.message });
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: 'VALIDATION',
        message: 'Données invalides. Vérifiez les champs du formulaire.',
        fields: err.issues.map((i) => i.path.join('.')),
      });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return reply.status(status).send({ error: 'BAD_REQUEST', message: 'Requête invalide.' });
    reply.log.error(err);
    return reply.status(500).send({ error: 'INTERNAL', message: 'Erreur interne. Réessayez dans un instant.' });
  });

  // ---------------------------------------------------------------- boutiques

  app.post('/api/shops', async (req, reply) => {
    const input = ShopInput.parse(req.body);
    const shop = ctx.shops.create({ name: input.name, city: input.city, pinHash: await hashPin(input.pin) });
    const sellerToken = ctx.tokens.issue({ role: 'seller', shopId: shop.id });
    return reply.status(201).send({ shopId: shop.id, slug: shop.slug, sellerToken });
  });

  app.post('/api/shops/login', async (req) => {
    const input = LoginInput.parse(req.body);
    if (!loginLimiter.take(input.slug)) throw new HttpError(429, 'RATE_LIMITED', "Trop d'essais. Réessayez dans une minute.");
    const shop = ctx.shops.bySlug(input.slug);
    if (!shop || !(await verifyPin(input.pin, shop.pinHash))) throw new HttpError(401, 'BAD_PIN', 'Code PIN incorrect.');
    return { shopId: shop.id, slug: shop.slug, sellerToken: ctx.tokens.issue({ role: 'seller', shopId: shop.id }) };
  });

  app.get('/api/shops/me/orders', async (req) => {
    const shop = sellerShop(req);
    const orders = await ctx.store.listByShop(shop.id);
    const locked = orders.filter((o) => o.state === 'FUNDS_LOCKED' || o.state === 'OUT_FOR_DELIVERY');
    const released = orders.filter((o) => o.state === 'RELEASED');
    return {
      shop: { name: shop.name, slug: shop.slug, city: shop.city },
      orders: orders.map((o) => view(o, shop, 'seller')),
      summary: {
        releasedXof: released.reduce((s, o) => s + netXof(o), 0),
        releasedCount: released.length,
        lockedXof: locked.reduce((s, o) => s + o.itemXof + o.deliveryFeeXof, 0),
        inDeliveryCount: orders.filter((o) => o.state === 'OUT_FOR_DELIVERY').length,
      },
    };
  });

  app.get('/api/shops/me/events', async (req, reply) => {
    const shop = sellerShop(req);
    sse(req, reply, (fn) => ctx.hub.subscribeShop(shop.id, fn), null);
  });

  function shopBySlug(req: FastifyRequest): Shop {
    const { slug } = z.object({ slug: z.string().max(60) }).parse(req.params);
    const shop = ctx.shops.bySlug(slug);
    if (!shop) throw new HttpError(404, 'SHOP_NOT_FOUND', 'Boutique introuvable.');
    return shop;
  }

  app.get('/api/shops/:slug/reputation', async (req) => {
    const shop = shopBySlug(req);
    return { shopName: shop.name, city: shop.city, since: shop.createdAt, npub: nip19.npubEncode(shop.nostrPubkey), ...(await reputation(shop.id)) };
  });

  /** Reçus signés de la boutique : le navigateur les vérifie lui-même (signature + preuve de paiement). */
  app.get('/api/shops/:slug/receipts', async (req) => {
    const shop = shopBySlug(req);
    return {
      shopName: shop.name,
      city: shop.city,
      since: shop.createdAt,
      pubkey: shop.nostrPubkey,
      npub: nip19.npubEncode(shop.nostrPubkey),
      relays: ctx.config.nostrRelays ?? [],
      events: ctx.receipts.listByShop(shop.id),
    };
  });

  // ---------------------------------------------------------------- commandes

  app.post('/api/orders', async (req, reply) => {
    const shop = sellerShop(req);
    const input = OrderInput.parse(req.body);
    const order = await ctx.engine.createOrder({ shopId: shop.id, ...input, xofPerBtc: await ctx.rate.xofPerBtc() });
    const clientToken = ctx.tokens.issue({ role: 'client', shopId: shop.id, orderId: order.id });
    return reply.status(201).send({ order: view(order, shop, 'seller'), clientToken });
  });

  app.get('/api/orders/:id', async (req) => {
    const { grant, order, shop } = await orderFor(req, ['seller', 'client', 'courier']);
    return { ...view(order, shop, grant.role), reputation: await reputation(shop.id) };
  });

  app.get('/api/orders/:id/events', async (req, reply) => {
    const { grant, order, shop } = await orderFor(req, ['seller', 'client', 'courier']);
    sse(req, reply, (fn) => ctx.hub.subscribe(order.id, fn), view(order, shop, grant.role));
  });

  app.post('/api/orders/:id/lock', async (req) => {
    const { order } = await orderFor(req, ['client']);
    const { paymentHash } = LockInput.parse(req.body);
    const res = await ctx.engine.lock(order.id, paymentHash);
    return { bolt11: res.bolt11, amountSat: (res.amountMsat / 1000n).toString(), expiresAt: res.expiresAt };
  });

  app.post('/api/orders/:id/assign', async (req) => {
    const { order, shop } = await orderFor(req, ['seller']);
    const { lightningAddress } = AssignInput.parse(req.body);
    const updated = await ctx.engine.assignCourier(order.id, lightningAddress);
    const courierToken = ctx.tokens.issue({ role: 'courier', shopId: shop.id, orderId: order.id });
    return { courierToken, order: view(updated, shop, 'seller') };
  });

  app.post('/api/orders/:id/release', async (req) => {
    const { grant, order, shop } = await orderFor(req, ['client', 'courier']);
    const { preimage } = ReleaseInput.parse(req.body);
    if (!releaseLimiter.take(order.id)) throw new HttpError(429, 'RATE_LIMITED', "Trop d'essais. Réessayez dans une minute.");
    const updated = await ctx.engine.release(order.id, preimage);
    return view(updated, shop, grant.role);
  });

  app.post('/api/orders/:id/cancel', async (req) => {
    const { order, shop } = await orderFor(req, ['seller']);
    return view(await ctx.engine.cancel(order.id), shop, 'seller');
  });

  // ---------------------------------------------------------------- démo (simulation uniquement)

  app.post('/api/demo/pay/:id', async (req) => {
    if (ctx.config.mode !== 'simulation' || !ctx.simWallet) throw new HttpError(404, 'NOT_FOUND', 'Indisponible.');
    const { grant, order, shop } = await orderFor(req, ['client']);
    if (order.state !== 'AWAITING_PAYMENT' || !order.paymentHash) throw new EscrowError('ORDER_NOT_LOCKABLE');
    await ctx.simWallet.simulatePayment(order.paymentHash, order.amountMsat);
    const updated = await ctx.store.get(order.id);
    return view(updated!, shop, grant.role);
  });

  // ---------------------------------------------------------------- IA, taux, santé

  app.post('/api/ai/extract-order', async (req) => {
    sellerShop(req);
    const { text } = ExtractInput.parse(req.body);
    return extractOrder(text, ctx.config.llm ?? {});
  });

  app.get('/api/rate', async () => ({ xofPerBtc: await ctx.rate.xofPerBtc(), at: new Date() }));

  app.get('/healthz', async () => ({ ok: true, mode: ctx.config.mode }));

  return app;
}

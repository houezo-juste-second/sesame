/**
 * API HTTP de Sésame (cahier des charges §11).
 * Toutes les entrées sont validées par Zod ; toutes les erreurs ont un message en français.
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import * as nip19 from 'nostr-tools/nip19';
import { STATE_LABEL_FR } from '@sesame/core';
import { randomInt } from 'node:crypto';
import { AdminSessions, adminOverview } from './admin.js';
import { bearer, hashPin, verifyPin, type Grant, type Role } from './auth.js';
import { AiUnavailableError, extractOrder, extractOrderFromImage, IMAGE_DATA_URL, MAX_IMAGE_BYTES, MAX_INPUT_CHARS } from './ai/extract.js';
import { EscrowError, type EngineEvent, type EscrowErrorCode } from './escrow/engine.js';
import type { Order } from './escrow/types.js';
import type { ServerContext } from './context.js';
import { NwcError } from './wallet/nwc.js';
import { MOMO_OPERATORS, payoutDestination, payoutLabel, type Shop, type ShopPayout } from './shops.js';

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
  courierFeeXof: z.number().int().min(0).max(1_000_000).optional(),
});
const LockInput = z.object({ paymentHash: z.string().regex(/^[0-9a-fA-F]{64}$/) });
const ReleaseInput = z.object({ preimage: z.string().regex(/^[0-9a-fA-F]{64}$/) });
const AssignInput = z.object({ lightningAddress: z.string().trim().min(3).max(320) });
const ExtractInput = z.object({ text: z.string().min(1).max(MAX_INPUT_CHARS) });
const ImageInput = z.object({ image: z.string().max(Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 40).regex(IMAGE_DATA_URL) });
const IdParam = z.object({ id: z.string().uuid() });
const AdminLoginInput = z.object({ code: z.string().min(1).max(128) });
const SuspendInput = z.object({ suspended: z.boolean() });
const Phone = z.string().transform((v) => v.replace(/[\s.-]/g, '')).pipe(z.string().regex(/^\+?\d{8,15}$/));
const Operator = z.enum(MOMO_OPERATORS);
const PayoutInput = z.discriminatedUnion('method', [
  z.object({ method: z.literal('momo'), operator: Operator, phone: Phone }),
  z.object({ method: z.literal('lightning'), address: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,}$/) }),
]);
const MomoPayInput = z.object({ operator: Operator, phone: Phone });
const WalletInput = z.object({ uri: z.string().trim().min(20).max(2000) });
const REAL_WALLET_MSG = 'Paiement réel : payez avec votre wallet Lightning en scannant le QR.';

/** « momo:MTN MoMo:42 » → « MTN MoMo •• 42 » */
function destinationLabel(d: string | undefined): string | null {
  if (!d) return null;
  const m = /^momo:(.+):(\d{2})$/.exec(d);
  return m ? `${m[1]} •• ${m[2]}` : d;
}

const SUSPENDED_MSG = 'Cette boutique est suspendue. Contactez le support Sésame.';

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
  // En-têtes de sécurité sur toutes les réponses (sans dépendance supplémentaire).
  const CSP = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // attributs style des composants
    "img-src 'self' data:",              // QR codes générés en data:
    "font-src 'self'",
    "connect-src 'self' wss:",           // relais Nostr de la page de vérification
    "manifest-src 'self'",
    "worker-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
    reply.header('content-security-policy', CSP);
    reply.header('permissions-policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
    if (req.headers['x-forwarded-proto'] === 'https') reply.header('strict-transport-security', 'max-age=31536000');
    if (req.url.startsWith('/api')) reply.header('cache-control', 'no-store');
  });

  const releaseLimiter = new Limiter(5, 60_000);
  const loginLimiter = new Limiter(5, 60_000);
  const adminLimiter = new Limiter(5, 60_000);
  const demoLimiter = new Limiter(30, 60_000);
  const walletLimiter = new Limiter(5, 60_000);
  const imageLimiter = new Limiter(10, 60_000);
  const admin = new AdminSessions(ctx.config.adminCode);

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

  /** write : action qui engage la boutique (nouvelle commande, livreur…) — refusée si elle est suspendue. */
  function sellerShop(req: FastifyRequest, write = false): Shop {
    const grant = grantOf(req);
    if (grant.role !== 'seller') throw new HttpError(403, 'FORBIDDEN', 'Réservé à la vendeuse.');
    const shop = ctx.shops.get(grant.shopId);
    if (!shop) throw new HttpError(401, 'UNAUTHORIZED', 'Boutique introuvable.');
    if (write && shop.suspended) throw new HttpError(403, 'SHOP_SUSPENDED', SUSPENDED_MSG);
    return shop;
  }

  async function reputation(shopId: string) {
    const orders = await ctx.store.listByShop(shopId);
    return {
      released: orders.filter((o) => o.state === 'RELEASED').length,
      refunded: orders.filter((o) => o.state === 'REFUNDED').length,
    };
  }

  const courierFee = (o: Order) => o.courierFeeXof ?? o.deliveryFeeXof;

  function netXof(o: Order): number {
    return o.itemXof + o.deliveryFeeXof - (o.courierAddress ? courierFee(o) : 0) - o.feeXof;
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
      simulation: o.walletKind !== 'nwc',
      realWallet: o.walletKind === 'nwc',
    };
    if (role === 'client') return { ...base, bolt11: o.state === 'AWAITING_PAYMENT' ? o.bolt11 ?? null : null, payment: o.payment ?? null };
    if (role === 'courier') return { ...base, courierFeeXof: courierFee(o) };
    return {
      ...base,
      courierAddress: o.courierAddress ?? null,
      courierFeeXof: courierFee(o),
      feeXof: o.feeXof,
      netXof: netXof(o),
      payouts: o.payouts.map((p) => ({ kind: p.kind, status: p.status })),
      payment: o.payment ?? null,
      sellerPayoutLabel: destinationLabel(o.sellerPayoutTo),
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
    if (err instanceof NwcError) {
      const client = ['INVALID_URI', 'HOLD_UNSUPPORTED', 'BAD_ADDRESS', 'BAD_AMOUNT'].includes(err.code);
      return reply.status(client ? 400 : 502).send({ error: err.code, message: err.message });
    }
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
    if (shop.suspended) throw new HttpError(403, 'SHOP_SUSPENDED', SUSPENDED_MSG);
    return { shopId: shop.id, slug: shop.slug, sellerToken: ctx.tokens.issue({ role: 'seller', shopId: shop.id }) };
  });

  app.get('/api/shops/me/orders', async (req) => {
    const shop = sellerShop(req);
    const orders = await ctx.store.listByShop(shop.id);
    const locked = orders.filter((o) => o.state === 'FUNDS_LOCKED' || o.state === 'OUT_FOR_DELIVERY');
    const released = orders.filter((o) => o.state === 'RELEASED');
    return {
      shop: { name: shop.name, slug: shop.slug, city: shop.city, suspended: shop.suspended, demo: shop.demo, payoutLabel: payoutLabel(ctx.shops.getPayout(shop.id)), walletConnected: ctx.wallets.isConnected(shop.id) },
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

  /** Comment la vendeuse reçoit son argent. Le numéro complet n'est jamais renvoyé. */
  function payoutView(p: ShopPayout | undefined) {
    if (!p) return { method: 'wallet' as const, label: null };
    return p.method === 'momo'
      ? { method: 'momo' as const, operator: p.operator, phoneHint: p.phone.slice(-2), label: payoutLabel(p) }
      : { method: 'lightning' as const, address: p.address, label: payoutLabel(p) };
  }

  app.get('/api/shops/me/payout', async (req) => {
    const shop = sellerShop(req);
    return payoutView(ctx.shops.getPayout(shop.id));
  });

  app.post('/api/shops/me/payout', async (req) => {
    const shop = sellerShop(req, true);
    const input = PayoutInput.parse(req.body);
    ctx.shops.setPayout(shop.id, input);
    return payoutView(input);
  });

  // ---------------------------------------------------------------- wallet de la vendeuse (NWC)

  app.get('/api/shops/me/wallet', async (req) => {
    const shop = sellerShop(req);
    return { connected: ctx.wallets.isConnected(shop.id) };
  });

  app.post('/api/shops/me/wallet', async (req) => {
    const shop = sellerShop(req, true);
    const { uri } = WalletInput.parse(req.body);
    if (!walletLimiter.take(shop.id)) throw new HttpError(429, 'RATE_LIMITED', "Trop d'essais. Réessayez dans une minute.");
    const info = await ctx.wallets.connect(shop.id, uri);
    ctx.audit.append({ orderId: `shop:${shop.id}`, event: 'WALLET_CONNECTED', payload: { shop: shop.slug } });
    return { connected: true, encryption: info.encryption, holdInvoices: true };
  });

  app.post('/api/shops/me/wallet/disconnect', async (req) => {
    const shop = sellerShop(req);
    const pending = (await ctx.store.listByShop(shop.id)).filter(
      (o) => o.walletKind === 'nwc' && ['AWAITING_PAYMENT', 'FUNDS_LOCKED', 'OUT_FOR_DELIVERY'].includes(o.state),
    );
    if (pending.length) throw new HttpError(409, 'ORDERS_PENDING', 'Des commandes payées attendent encore leur livraison. Débranchez le wallet après.');
    ctx.wallets.disconnect(shop.id);
    ctx.audit.append({ orderId: `shop:${shop.id}`, event: 'WALLET_DISCONNECTED', payload: { shop: shop.slug } });
    return { connected: false };
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
    const shop = sellerShop(req, true);
    const input = OrderInput.parse(req.body);
    const real = ctx.wallets.isConnected(shop.id);
    const order = await ctx.engine.createOrder({
      shopId: shop.id, ...input, xofPerBtc: await ctx.rate.xofPerBtc(),
      // Wallet réel : les sats arrivent directement dans le wallet de la vendeuse.
      walletKind: real ? 'nwc' : 'simulation',
      sellerPayoutTo: real ? undefined : payoutDestination(ctx.shops.getPayout(shop.id)),
    });
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
    const { order, shop } = await orderFor(req, ['client']);
    if (shop.suspended) throw new HttpError(403, 'SHOP_SUSPENDED', 'Cette boutique est suspendue : ne payez pas cette commande.');
    const { paymentHash } = LockInput.parse(req.body);
    const res = await ctx.engine.lock(order.id, paymentHash);
    return { bolt11: res.bolt11, amountSat: (res.amountMsat / 1000n).toString(), expiresAt: res.expiresAt };
  });

  app.post('/api/orders/:id/assign', async (req) => {
    const { order, shop } = await orderFor(req, ['seller']);
    if (shop.suspended) throw new HttpError(403, 'SHOP_SUSPENDED', SUSPENDED_MSG);
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
    if (order.walletKind === 'nwc') throw new HttpError(409, 'REAL_WALLET', REAL_WALLET_MSG);
    if (order.state !== 'AWAITING_PAYMENT' || !order.paymentHash) throw new EscrowError('ORDER_NOT_LOCKABLE');
    await ctx.store.save({ ...order, payment: { method: 'lightning' } });
    await ctx.simWallet.simulatePayment(order.paymentHash, order.amountMsat);
    const updated = await ctx.store.get(order.id);
    return view(updated!, shop, grant.role);
  });

  /**
   * Paiement Mobile Money (simulation du partenaire de change, ex. Banxaas) :
   * le client paie en FCFA, le partenaire paie la facture hold Lightning. L'argent est alors bloqué comme d'habitude.
   * En production, cette route sera remplacée par le webhook du partenaire.
   */
  app.post('/api/orders/:id/pay/momo', async (req) => {
    if (ctx.config.mode !== 'simulation' || !ctx.simWallet) throw new HttpError(404, 'NOT_FOUND', 'Indisponible.');
    const { grant, order, shop } = await orderFor(req, ['client']);
    if (shop.suspended) throw new HttpError(403, 'SHOP_SUSPENDED', 'Cette boutique est suspendue : ne payez pas cette commande.');
    if (order.walletKind === 'nwc') throw new HttpError(409, 'REAL_WALLET', 'Le paiement Mobile Money arrive bientôt. ' + REAL_WALLET_MSG);
    if (order.state !== 'AWAITING_PAYMENT' || !order.paymentHash) throw new EscrowError('ORDER_NOT_LOCKABLE');
    const { operator, phone } = MomoPayInput.parse(req.body);
    await ctx.store.save({ ...order, payment: { method: 'momo', operator, phoneHint: phone.slice(-2) } });
    await ctx.simWallet.simulatePayment(order.paymentHash, order.amountMsat);
    const updated = await ctx.store.get(order.id);
    return view(updated!, shop, grant.role);
  });

  /**
   * « Essayer la démo » : une boutique de démonstration jetable et une commande prête.
   * Chaque visiteur a sa propre boutique : personne ne peut toucher aux commandes d'un autre.
   */
  app.post('/api/demo/start', async (_req, reply) => {
    if (ctx.config.mode !== 'simulation') throw new HttpError(404, 'NOT_FOUND', 'Indisponible.');
    if (!demoLimiter.take('demo')) throw new HttpError(429, 'RATE_LIMITED', 'Beaucoup de démos en cours. Réessayez dans une minute.');
    const shop = ctx.shops.create({
      name: 'Pagnes de Fifamè (démo)', city: 'Cotonou', demo: true,
      pinHash: await hashPin(String(randomInt(100_000, 1_000_000))), // PIN aléatoire jamais communiqué
    });
    const payout: ShopPayout = { method: 'momo', operator: 'MTN MoMo', phone: '0197000042' };
    ctx.shops.setPayout(shop.id, payout);
    const order = await ctx.engine.createOrder({
      shopId: shop.id, itemLabel: '2 pagnes wax bleus', itemXof: 18_000, deliveryFeeXof: 1_500, deliveryHours: 6,
      xofPerBtc: await ctx.rate.xofPerBtc(), sellerPayoutTo: payoutDestination(payout),
    });
    return reply.status(201).send({
      slug: shop.slug,
      orderId: order.id,
      sellerToken: ctx.tokens.issue({ role: 'seller', shopId: shop.id }),
      clientToken: ctx.tokens.issue({ role: 'client', shopId: shop.id, orderId: order.id }),
    });
  });

  // ---------------------------------------------------------------- administration

  function requireAdmin(req: FastifyRequest): void {
    if (!admin.enabled) throw new HttpError(404, 'NOT_FOUND', 'Introuvable.');
    if (!admin.check(bearer(req.headers.authorization))) throw new HttpError(401, 'UNAUTHORIZED', 'Session expirée. Reconnectez-vous.');
  }

  app.post('/api/admin/login', async (req) => {
    if (!admin.enabled) throw new HttpError(404, 'NOT_FOUND', 'Introuvable.');
    if (!adminLimiter.take('admin')) throw new HttpError(429, 'RATE_LIMITED', "Trop d'essais. Réessayez dans une minute.");
    const { code } = AdminLoginInput.parse(req.body);
    const token = admin.login(code);
    if (!token) throw new HttpError(401, 'BAD_CODE', "Code d'accès incorrect.");
    return { adminToken: token };
  });

  app.get('/api/admin/overview', async (req) => {
    requireAdmin(req);
    return adminOverview(ctx);
  });

  app.post('/api/admin/shops/:id/suspend', async (req) => {
    requireAdmin(req);
    const { id } = IdParam.parse(req.params);
    const { suspended } = SuspendInput.parse(req.body);
    const shop = ctx.shops.get(id);
    if (!shop) throw new HttpError(404, 'SHOP_NOT_FOUND', 'Boutique introuvable.');
    ctx.shops.setSuspended(id, suspended);
    ctx.audit.append({ orderId: `shop:${id}`, event: suspended ? 'SHOP_SUSPENDED' : 'SHOP_REINSTATED', payload: { shop: shop.slug } });
    return { id, suspended };
  });

  // ---------------------------------------------------------------- IA, taux, santé

  app.post('/api/ai/extract-order', async (req) => {
    sellerShop(req, true);
    const { text } = ExtractInput.parse(req.body);
    return extractOrder(text, ctx.config.llm ?? {});
  });

  /** Capture d'écran d'une conversation → commande (IA « vision » uniquement ; image ni stockée ni journalisée). */
  app.post('/api/ai/extract-order-image', { bodyLimit: 2_200_000 }, async (req) => {
    const shop = sellerShop(req, true);
    if (!imageLimiter.take(shop.id)) throw new HttpError(429, 'RATE_LIMITED', "Trop d'essais. Réessayez dans une minute.");
    const { image } = ImageInput.parse(req.body);
    try {
      return await extractOrderFromImage(image, ctx.config.llm ?? {});
    } catch (e) {
      if (e instanceof AiUnavailableError) {
        throw new HttpError(503, 'AI_UNAVAILABLE', "Lecture de la capture indisponible pour le moment. Copiez plutôt le texte de la conversation.");
      }
      throw e;
    }
  });

  app.get('/api/rate', async () => ({ xofPerBtc: await ctx.rate.xofPerBtc(), at: new Date() }));

  app.get('/healthz', async () => ({ ok: true, mode: ctx.config.mode, ai: ctx.config.llm?.baseUrl && ctx.config.llm.model ? 'llm' : 'rules' }));

  return app;
}

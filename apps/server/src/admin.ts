/**
 * Administration (lecture seule + suspension de boutique).
 * L'administrateur ne touche jamais à l'argent : aucune route ne peut libérer, rembourser ou déplacer des fonds.
 * Il ne voit ni sésame, ni jeton, ni clé : uniquement des montants, des états et le journal d'audit (déjà expurgé).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { OrderState } from '@sesame/core';
import { verifyChain } from './audit/log.js';
import type { ServerContext } from './context.js';

const STATES: OrderState[] = ['DRAFT', 'AWAITING_PAYMENT', 'FUNDS_LOCKED', 'OUT_FOR_DELIVERY', 'RELEASED', 'REFUNDED', 'EXPIRED'];
const SESSION_MS = 12 * 60 * 60 * 1000;

const sha = (s: string) => createHash('sha256').update(s).digest();

/** Sessions d'administration en mémoire : 12 h, perdues au redémarrage (il suffit de se reconnecter). */
export class AdminSessions {
  private readonly sessions = new Map<string, number>();

  constructor(private readonly code: string | undefined, private readonly now: () => number = Date.now) {}

  get enabled(): boolean {
    return Boolean(this.code);
  }

  /** Compare le code en temps constant ; renvoie un jeton de session ou undefined. */
  login(code: string): string | undefined {
    if (!this.code || !timingSafeEqual(sha(code), sha(this.code))) return undefined;
    const token = randomBytes(24).toString('base64url');
    this.sessions.set(sha(token).toString('hex'), this.now() + SESSION_MS);
    return token;
  }

  check(token: string | undefined): boolean {
    if (!token) return false;
    const key = sha(token).toString('hex');
    const exp = this.sessions.get(key);
    if (!exp) return false;
    if (exp < this.now()) {
      this.sessions.delete(key);
      return false;
    }
    return true;
  }
}

export async function adminOverview(ctx: ServerContext, now = new Date()) {
  const shops = ctx.shops.list();
  const orders = await ctx.store.listAll();
  const demoShops = new Set(shops.filter((s) => s.demo).map((s) => s.id));
  const real = orders.filter((o) => !demoShops.has(o.shopId));

  const byState = Object.fromEntries(STATES.map((s) => [s, 0])) as Record<OrderState, number>;
  for (const o of real) byState[o.state] += 1;

  const released = real.filter((o) => o.state === 'RELEASED');
  const locked = real.filter((o) => o.state === 'FUNDS_LOCKED' || o.state === 'OUT_FOR_DELIVERY');
  const total = (o: { itemXof: number; deliveryFeeXof: number }) => o.itemXof + o.deliveryFeeXof;

  // Alertes : ce qui demande un œil humain.
  const overdue = locked.filter((o) => o.releaseDeadlineAt && o.releaseDeadlineAt.getTime() < now.getTime() - 60_000);
  const payoutsFailed = orders.filter((o) => o.payouts.some((p) => p.status === 'failed')).length;
  const payoutsPending = orders.filter((o) => o.payouts.some((p) => p.status === 'pending')).length;
  const settlePending = orders.filter((o) => o.pendingPreimage).length;

  const entries = ctx.audit.entries();
  const chain = verifyChain(entries);

  const perShop = new Map<string, { orders: number; released: number; volumeXof: number }>();
  for (const o of orders) {
    const s = perShop.get(o.shopId) ?? { orders: 0, released: 0, volumeXof: 0 };
    s.orders += 1;
    if (o.state === 'RELEASED') {
      s.released += 1;
      s.volumeXof += total(o);
    }
    perShop.set(o.shopId, s);
  }

  return {
    mode: ctx.config.mode,
    generatedAt: now,
    totals: {
      shops: shops.filter((s) => !s.demo).length,
      demoShops: demoShops.size,
      orders: real.length,
      demoOrders: orders.length - real.length,
      releasedXof: released.reduce((s, o) => s + total(o), 0),
      feesXof: released.reduce((s, o) => s + o.feeXof, 0),
      lockedXof: locked.reduce((s, o) => s + total(o), 0),
      successRate: released.length + byState.REFUNDED > 0
        ? Math.round((released.length / (released.length + byState.REFUNDED)) * 100)
        : null,
    },
    byState,
    alerts: {
      auditChainOk: chain.ok,
      auditBrokenAt: chain.ok ? null : chain.brokenAt,
      auditEntries: entries.length,
      overdue: overdue.length,
      payoutsFailed,
      payoutsPending,
      settlePending,
    },
    shops: shops.map((s) => ({
      id: s.id, slug: s.slug, name: s.name, city: s.city, createdAt: s.createdAt, suspended: s.suspended, demo: s.demo,
      ...(perShop.get(s.id) ?? { orders: 0, released: 0, volumeXof: 0 }),
    })),
    recent: entries.slice(-15).reverse().map((e) => ({
      seq: e.seq, at: e.at, event: e.event, order: e.orderId.slice(0, 8), state: typeof e.payload.state === 'string' ? e.payload.state : null,
    })),
  };
}

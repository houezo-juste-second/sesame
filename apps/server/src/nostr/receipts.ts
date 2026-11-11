/**
 * Reçus Nostr : construits à la finalisation d'une commande, stockés, puis publiés
 * sur des relais publics si la publication est activée.
 */
import { checkReceipt, createReceipt, RECEIPT_KIND, type ReceiptCheck } from '@sesame/core';
import type { Event, VerifiedEvent } from 'nostr-tools/pure';
import type { Order, OrderStore } from '../escrow/types.js';
import type { ShopStore } from '../shops.js';
import type { Db } from '../db/sqlite.js';

export { RECEIPT_KIND };

export function buildReceipt(order: Order, shopSecretKey: Uint8Array): VerifiedEvent {
  if (order.state !== 'RELEASED' && order.state !== 'REFUNDED') throw new Error('ORDER_NOT_FINAL');
  if (!order.paymentHash) throw new Error('ORDER_WITHOUT_PAYMENT');
  return createReceipt(
    {
      orderId: order.id,
      outcome: order.state === 'RELEASED' ? 'released' : 'refunded',
      totalXof: order.itemXof + order.deliveryFeeXof,
      paymentHash: order.paymentHash,
      preimage: order.settledPreimage,
      at: order.updatedAt,
    },
    shopSecretKey,
  );
}

export function verifyReceipt(ev: Event): ReceiptCheck {
  return checkReceipt(ev);
}

/** Publication vers des relais. Implémentation réelle : SimplePool de nostr-tools. */
export interface RelayPublisher {
  publish(ev: VerifiedEvent): Promise<number>;
}

export class PoolPublisher implements RelayPublisher {
  constructor(private readonly relays: string[]) {}
  async publish(ev: VerifiedEvent): Promise<number> {
    const { SimplePool } = await import('nostr-tools/pool');
    const pool = new SimplePool();
    try {
      const results = await Promise.allSettled(pool.publish(this.relays, ev));
      return results.filter((r) => r.status === 'fulfilled').length;
    } finally {
      pool.close(this.relays);
    }
  }
}

export class ReceiptService {
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly db: Db,
    private readonly orders: OrderStore,
    private readonly shops: ShopStore,
    private readonly publisher: RelayPublisher | null,
    private readonly onError: (e: unknown) => void = () => undefined,
  ) {}

  /** Déclenché par le moteur à la finalisation ; ne bloque jamais le parcours de paiement. */
  onFinal(orderId: string): void {
    const p = this.issue(orderId).catch(this.onError).finally(() => this.pending.delete(p));
    this.pending.add(p);
  }

  /** Attend la fin des émissions en cours (tests, arrêt propre). */
  async idle(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  private async issue(orderId: string): Promise<void> {
    const order = await this.orders.get(orderId);
    if (!order || !order.paymentHash) return;
    const ev = buildReceipt(order, this.shops.nostrSecretKey(order.shopId));
    const dTag = ev.tags.find((t) => t[0] === 'd')![1]!;
    this.db
      .prepare('INSERT OR IGNORE INTO nostr_events (event_id, shop_id, d_tag, json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(ev.id, order.shopId, dTag, JSON.stringify(ev), ev.created_at);
    if (this.publisher) {
      const ok = await this.publisher.publish(ev);
      this.db.prepare('UPDATE nostr_events SET relays_ok = ? WHERE event_id = ?').run(ok, ev.id);
    }
  }

  listByShop(shopId: string, limit = 200): Event[] {
    const rows = this.db.prepare('SELECT json FROM nostr_events WHERE shop_id = ? ORDER BY created_at DESC LIMIT ?').all(shopId, limit) as Array<{ json: string }>;
    return rows.map((r) => JSON.parse(r.json) as Event);
  }
}

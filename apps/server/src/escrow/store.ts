import { isTerminal } from '@sesame/core';
import type { Order, OrderStore } from './types.js';

/** Stockage en mémoire (tests, simulation). Copie profonde pour imiter une vraie persistance. */
export class MemoryOrderStore implements OrderStore {
  private readonly orders = new Map<string, Order>();

  async get(id: string): Promise<Order | undefined> {
    const o = this.orders.get(id);
    return o ? structuredClone(o) : undefined;
  }

  async save(order: Order): Promise<void> {
    this.orders.set(order.id, structuredClone(order));
  }

  async findByPaymentHash(paymentHash: string): Promise<Order | undefined> {
    for (const o of this.orders.values()) if (o.paymentHash === paymentHash) return structuredClone(o);
    return undefined;
  }

  async listActionable(): Promise<Order[]> {
    return [...this.orders.values()]
      .filter((o) => (!isTerminal(o.state) && o.state !== 'DRAFT') || o.payouts.some((p) => p.status === 'pending'))
      .map((o) => structuredClone(o));
  }
}

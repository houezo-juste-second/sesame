import type { EngineEvent } from './escrow/engine.js';

type Listener = (e: EngineEvent) => void;

/** Diffusion en mémoire des événements de commande vers les flux temps réel (SSE). */
export class EventHub {
  private readonly listeners = new Map<string, Set<Listener>>();

  subscribe(orderId: string, fn: Listener): () => void {
    const set = this.listeners.get(orderId) ?? new Set<Listener>();
    set.add(fn);
    this.listeners.set(orderId, set);
    return () => {
      set.delete(fn);
      if (set.size === 0) this.listeners.delete(orderId);
    };
  }

  /** Abonnement à toutes les commandes d'une boutique (tableau de bord vendeuse). */
  subscribeShop(shopId: string, fn: Listener): () => void {
    return this.subscribe(`shop:${shopId}`, fn);
  }

  publish(e: EngineEvent, shopId?: string): void {
    for (const fn of this.listeners.get(e.orderId) ?? []) fn(e);
    if (shopId) for (const fn of this.listeners.get(`shop:${shopId}`) ?? []) fn(e);
  }
}

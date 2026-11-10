/**
 * Moteur de séquestre Sésame (cahier des charges §9).
 *
 * Invariants :
 *  - le moteur ne possède jamais de clé capable de dépenser l'argent du client ;
 *  - il ne connaît P qu'au moment où le client (ou le livreur) le lui remet ;
 *  - toute absence d'action conduit au remboursement, jamais à une perte.
 */
import { randomUUID } from 'node:crypto';
import {
  isHex32,
  isTerminal,
  serviceFeeXof,
  transition,
  verifyPreimage,
  xofToMsat,
  type OrderEvent,
  type OrderState,
} from '@sesame/core';
import type { PayoutSender, WalletAdapter } from '../wallet/types.js';
import type { Order, OrderStore, Payout } from './types.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const BLOCK_MS = 10 * MINUTE;

export const ERROR_MESSAGES = {
  ORDER_NOT_FOUND: 'Commande introuvable.',
  INVALID_ITEM_LABEL: "Le nom de l'article est obligatoire (120 caractères maximum).",
  INVALID_AMOUNT: 'Le prix doit être un nombre entier de FCFA, entre 1 et 5 000 000.',
  INVALID_DELIVERY_FEE: 'Les frais de livraison doivent être un nombre entier de FCFA positif ou nul.',
  INVALID_DELIVERY_HOURS: 'Le délai de livraison doit être compris entre 2 et 12 heures.',
  INVALID_PAYMENT_HASH: 'Code de paiement invalide.',
  PAYMENT_HASH_REUSED: 'Ce code de paiement a déjà été utilisé.',
  ORDER_NOT_LOCKABLE: 'Cette commande a déjà une facture.',
  ORDER_NOT_RELEASABLE: 'Cette commande ne peut pas (ou plus) être libérée.',
  PREIMAGE_MISMATCH: 'Ce sésame ne correspond pas à cette commande.',
  DEADLINE_PASSED: 'Le délai de livraison est dépassé : le client va être remboursé.',
  SETTLE_PENDING: 'Sésame bien reçu. Le paiement de la vendeuse est en cours de confirmation.',
  INVALID_LIGHTNING_ADDRESS: 'Adresse Lightning invalide (format : nom@domaine).',
  ORDER_NOT_ASSIGNABLE: "Un livreur ne peut être assigné qu'après le paiement.",
  ORDER_NOT_CANCELLABLE: 'Cette commande ne peut plus être annulée.',
} as const;

export type EscrowErrorCode = keyof typeof ERROR_MESSAGES;

export class EscrowError extends Error {
  constructor(readonly code: EscrowErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'EscrowError';
  }
}

export type EngineEventType =
  | 'ORDER_CREATED'
  | 'INVOICE_ISSUED'
  | 'FUNDS_LOCKED'
  | 'AMOUNT_MISMATCH'
  | 'COURIER_ASSIGNED'
  | 'SETTLE_PENDING'
  | 'SETTLE_ABANDONED'
  | 'RELEASED'
  | 'REFUNDED'
  | 'EXPIRED'
  | 'PAYOUT_SENT'
  | 'PAYOUT_FAILED'
  | 'PAYOUT_ABANDONED';

/** Événement émis vers le journal d'audit et les flux temps réel. Ne contient jamais de secret. */
export interface EngineEvent {
  type: EngineEventType;
  orderId: string;
  state: OrderState;
  at: Date;
  data?: Record<string, string | number> | undefined;
}

export interface CreateOrderInput {
  shopId: string;
  itemLabel: string;
  itemXof: number;
  deliveryFeeXof: number;
  deliveryHours: number;
  xofPerBtc: number;
  pro?: boolean;
}

export interface EngineDeps {
  walletFor: (shopId: string) => WalletAdapter;
  payouts: PayoutSender;
  store: OrderStore;
  clock?: () => Date;
  onEvent?: (e: EngineEvent) => void;
  /** Destination des frais de service. */
  feeDestination?: string;
  invoiceExpirySec?: number;
  cltvExpiryBlocks?: number;
  safetyMarginMs?: number;
  maxPayoutAttempts?: number;
}

const LIGHTNING_ADDRESS = /^[a-z0-9._-]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,}$/;

export class EscrowEngine {
  private readonly clock: () => Date;
  private readonly feeDestination: string;
  private readonly invoiceExpirySec: number;
  private readonly cltvExpiryBlocks: number;
  private readonly safetyMarginMs: number;
  private readonly maxPayoutAttempts: number;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: EngineDeps) {
    this.clock = deps.clock ?? (() => new Date());
    this.feeDestination = deps.feeDestination ?? 'fees@sesame.local';
    this.invoiceExpirySec = deps.invoiceExpirySec ?? 30 * 60;
    this.cltvExpiryBlocks = deps.cltvExpiryBlocks ?? 144;
    this.safetyMarginMs = deps.safetyMarginMs ?? 2 * HOUR;
    this.maxPayoutAttempts = deps.maxPayoutAttempts ?? 3;
  }

  // ------------------------------------------------------------------ commandes

  async createOrder(input: CreateOrderInput): Promise<Order> {
    const label = input.itemLabel.trim();
    if (label.length < 1 || label.length > 120) throw new EscrowError('INVALID_ITEM_LABEL');
    if (!Number.isSafeInteger(input.deliveryFeeXof) || input.deliveryFeeXof < 0) {
      throw new EscrowError('INVALID_DELIVERY_FEE');
    }
    if (!Number.isInteger(input.deliveryHours) || input.deliveryHours < 2 || input.deliveryHours > 12) {
      throw new EscrowError('INVALID_DELIVERY_HOURS');
    }
    let amountMsat: bigint, courierMsat: bigint, feeMsat: bigint;
    try {
      amountMsat = xofToMsat(input.itemXof + input.deliveryFeeXof, input.xofPerBtc);
      courierMsat = input.deliveryFeeXof > 0 ? xofToMsat(input.deliveryFeeXof, input.xofPerBtc) : 0n;
      feeMsat = xofToMsat(serviceFeeXof(input.itemXof, { pro: input.pro ?? false }), input.xofPerBtc);
    } catch {
      throw new EscrowError('INVALID_AMOUNT');
    }
    const now = this.clock();
    const order: Order = {
      id: randomUUID(),
      shopId: input.shopId,
      itemLabel: label,
      itemXof: input.itemXof,
      deliveryFeeXof: input.deliveryFeeXof,
      deliveryHours: input.deliveryHours,
      xofPerBtc: input.xofPerBtc,
      amountMsat,
      courierMsat,
      feeMsat,
      state: 'DRAFT',
      payouts: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.store.save(order);
    this.emit('ORDER_CREATED', order);
    return order;
  }

  /** Le client transmet H (jamais P) : la vendeuse émet une facture hold liée à H. */
  async lock(orderId: string, paymentHash: string): Promise<{ bolt11: string; amountMsat: bigint; expiresAt: Date }> {
    const hash = paymentHash.toLowerCase();
    if (!isHex32(hash)) throw new EscrowError('INVALID_PAYMENT_HASH');
    return this.withLock(orderId, async () => {
      const order = await this.load(orderId);
      if (order.state !== 'DRAFT') throw new EscrowError('ORDER_NOT_LOCKABLE');
      if (await this.deps.store.findByPaymentHash(hash)) throw new EscrowError('PAYMENT_HASH_REUSED');
      const { bolt11 } = await this.deps.walletFor(order.shopId).makeHoldInvoice({
        paymentHash: hash,
        amountMsat: order.amountMsat,
        description: `Sésame · ${order.itemLabel}`.slice(0, 100),
        expirySec: this.invoiceExpirySec,
        cltvExpiryBlocks: this.cltvExpiryBlocks,
      });
      const now = this.clock();
      order.paymentHash = hash;
      order.bolt11 = bolt11;
      order.invoiceExpiresAt = new Date(now.getTime() + this.invoiceExpirySec * 1000);
      await this.move(order, 'LOCK', 'INVOICE_ISSUED');
      return { bolt11, amountMsat: order.amountMsat, expiresAt: order.invoiceExpiresAt };
    });
  }

  /** Notification du wallet : le paiement du client est arrivé et reste bloqué. */
  async handleInvoiceAccepted(paymentHash: string, amountPaidMsat: bigint): Promise<void> {
    const found = await this.deps.store.findByPaymentHash(paymentHash.toLowerCase());
    if (!found) return;
    await this.withLock(found.id, async () => {
      const order = await this.load(found.id);
      if (order.state !== 'AWAITING_PAYMENT') return;
      const now = this.clock();
      order.acceptedAt = now;
      order.htlcExpiresAt = new Date(now.getTime() + this.cltvExpiryBlocks * BLOCK_MS);
      order.releaseDeadlineAt = new Date(
        Math.min(now.getTime() + order.deliveryHours * HOUR, order.htlcExpiresAt.getTime() - this.safetyMarginMs),
      );
      await this.move(order, 'PAYMENT_ACCEPTED', 'FUNDS_LOCKED');
      if (amountPaidMsat !== order.amountMsat) {
        this.emit('AMOUNT_MISMATCH', order, { paidMsat: amountPaidMsat.toString() });
        await this.refund(order);
      }
    });
  }

  async assignCourier(orderId: string, lightningAddress: string): Promise<Order> {
    const address = lightningAddress.trim().toLowerCase();
    if (!LIGHTNING_ADDRESS.test(address)) throw new EscrowError('INVALID_LIGHTNING_ADDRESS');
    return this.withLock(orderId, async () => {
      const order = await this.load(orderId);
      if (order.state !== 'FUNDS_LOCKED') throw new EscrowError('ORDER_NOT_ASSIGNABLE');
      order.courierAddress = address;
      await this.move(order, 'ASSIGN_COURIER', 'COURIER_ASSIGNED');
      return order;
    });
  }

  /** Le client remet P (QR scanné par le livreur, ou bouton « J'ai reçu »). */
  async release(orderId: string, preimage: string): Promise<Order> {
    return this.withLock(orderId, async () => {
      const order = await this.load(orderId);
      if (order.state !== 'FUNDS_LOCKED' && order.state !== 'OUT_FOR_DELIVERY') {
        throw new EscrowError('ORDER_NOT_RELEASABLE');
      }
      if (!order.paymentHash || !verifyPreimage(preimage, order.paymentHash)) {
        throw new EscrowError('PREIMAGE_MISMATCH');
      }
      if (this.clock().getTime() >= (order.releaseDeadlineAt?.getTime() ?? 0)) {
        throw new EscrowError('DEADLINE_PASSED');
      }
      order.pendingPreimage = preimage.toLowerCase();
      await this.save(order);
      const settled = await this.trySettle(order);
      if (!settled) throw new EscrowError('SETTLE_PENDING');
      return order;
    });
  }

  /** Annulation par la vendeuse : remboursement immédiat du client. */
  async cancel(orderId: string): Promise<Order> {
    return this.withLock(orderId, async () => {
      const order = await this.load(orderId);
      if (order.state === 'AWAITING_PAYMENT') {
        await this.cancelInvoiceQuietly(order);
        await this.move(order, 'INVOICE_EXPIRED', 'EXPIRED');
        return order;
      }
      if ((order.state !== 'FUNDS_LOCKED' && order.state !== 'OUT_FOR_DELIVERY') || order.pendingPreimage) {
        throw new EscrowError('ORDER_NOT_CANCELLABLE');
      }
      await this.refund(order);
      return order;
    });
  }

  // ------------------------------------------------------------------ planificateur

  /** À appeler toutes les 30 s : échéances, règlements en attente, répartitions à réessayer. */
  async tick(): Promise<void> {
    for (const snapshot of await this.deps.store.listActionable()) {
      await this.withLock(snapshot.id, async () => {
        const order = await this.load(snapshot.id);
        await this.tickOne(order);
      });
    }
  }

  private async tickOne(order: Order): Promise<void> {
    const now = this.clock().getTime();
    if (order.state === 'AWAITING_PAYMENT') {
      if (order.invoiceExpiresAt && now >= order.invoiceExpiresAt.getTime()) {
        await this.cancelInvoiceQuietly(order);
        await this.move(order, 'INVOICE_EXPIRED', 'EXPIRED');
      }
      return;
    }
    if (order.state === 'FUNDS_LOCKED' || order.state === 'OUT_FOR_DELIVERY') {
      if (order.pendingPreimage) {
        if (await this.trySettle(order)) return;
        // Dernier recours : ne jamais laisser le HTLC expirer de force (fermeture de canal).
        if (order.htlcExpiresAt && now >= order.htlcExpiresAt.getTime() - HOUR) {
          this.emit('SETTLE_ABANDONED', order);
          order.pendingPreimage = undefined;
          await this.refund(order);
        }
        return;
      }
      if (order.releaseDeadlineAt && now >= order.releaseDeadlineAt.getTime()) await this.refund(order);
      return;
    }
    if (order.state === 'RELEASED') await this.runPayouts(order);
  }

  // ------------------------------------------------------------------ interne

  private async trySettle(order: Order): Promise<boolean> {
    try {
      await this.deps.walletFor(order.shopId).settleHoldInvoice(order.pendingPreimage!);
    } catch {
      this.emit('SETTLE_PENDING', order);
      return false;
    }
    order.settledPreimage = order.pendingPreimage;
    order.pendingPreimage = undefined;
    order.payouts = this.plannedPayouts(order);
    await this.move(order, 'RELEASE', 'RELEASED');
    await this.runPayouts(order);
    return true;
  }

  private plannedPayouts(order: Order): Payout[] {
    const list: Payout[] = [];
    if (order.courierAddress && order.courierMsat > 0n) {
      list.push({ kind: 'courier', destination: order.courierAddress, amountMsat: order.courierMsat, status: 'pending', attempts: 0 });
    }
    if (order.feeMsat > 0n) {
      list.push({ kind: 'service_fee', destination: this.feeDestination, amountMsat: order.feeMsat, status: 'pending', attempts: 0 });
    }
    return list;
  }

  private async runPayouts(order: Order): Promise<void> {
    for (const p of order.payouts) {
      if (p.status !== 'pending') continue;
      p.attempts += 1;
      try {
        await this.deps.payouts.send({
          shopId: order.shopId,
          destination: p.destination,
          amountMsat: p.amountMsat,
          kind: p.kind,
          memo: `Sésame · commande ${order.id.slice(0, 8)}`,
        });
        p.status = 'sent';
        p.lastErrorCode = undefined;
        this.emit('PAYOUT_SENT', order, { kind: p.kind });
      } catch (e) {
        p.lastErrorCode = e instanceof Error ? e.message.slice(0, 64) : 'UNKNOWN';
        if (p.attempts >= this.maxPayoutAttempts) {
          p.status = 'failed';
          this.emit('PAYOUT_ABANDONED', order, { kind: p.kind, attempts: p.attempts });
        } else {
          this.emit('PAYOUT_FAILED', order, { kind: p.kind, attempts: p.attempts });
        }
      }
    }
    await this.save(order);
  }

  private async refund(order: Order): Promise<void> {
    await this.deps.walletFor(order.shopId).cancelHoldInvoice(order.paymentHash!);
    await this.move(order, 'REFUND', 'REFUNDED');
  }

  private async cancelInvoiceQuietly(order: Order): Promise<void> {
    if (!order.paymentHash) return;
    try {
      await this.deps.walletFor(order.shopId).cancelHoldInvoice(order.paymentHash);
    } catch {
      /* facture déjà expirée côté wallet : rien à rembourser */
    }
  }

  private async move(order: Order, event: OrderEvent, emitted: EngineEventType): Promise<void> {
    order.state = transition(order.state, event);
    await this.save(order);
    this.emit(emitted, order);
  }

  private async save(order: Order): Promise<void> {
    order.updatedAt = this.clock();
    await this.deps.store.save(order);
  }

  private async load(id: string): Promise<Order> {
    const o = await this.deps.store.get(id);
    if (!o) throw new EscrowError('ORDER_NOT_FOUND');
    return o;
  }

  private emit(type: EngineEventType, order: Order, data?: Record<string, string | number>): void {
    this.deps.onEvent?.({ type, orderId: order.id, state: order.state, at: this.clock(), data });
  }

  /** Sérialise les opérations sur une même commande (évite double libération / course avec le planificateur). */
  private async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(fn);
    const tail = run.catch(() => undefined);
    this.locks.set(id, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(id) === tail) this.locks.delete(id);
    }
  }

  /** Utilitaire pour l'API : état terminal ? */
  static isFinal(order: Order): boolean {
    return isTerminal(order.state);
  }
}

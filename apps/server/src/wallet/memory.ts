/**
 * Wallet SIMULÉ en mémoire : reproduit fidèlement le cycle d'une facture hold
 * (OPEN → ACCEPTED → SETTLED | CANCELED) sans réseau Lightning.
 * Utilisé par les tests et par le mode « simulation » clairement signalé à l'écran.
 * Aucun argent réel ne transite.
 */
import { hashPreimage } from '@sesame/core';
import type {
  HoldInvoiceState,
  MakeHoldInvoiceParams,
  PayoutKind,
  PayoutRequest,
  PayoutSender,
  WalletAdapter,
} from './types.js';

interface MemInvoice {
  amountMsat: bigint;
  paidMsat: bigint;
  state: HoldInvoiceState;
  bolt11: string;
}

type AcceptedListener = (paymentHash: string, amountPaidMsat: bigint) => Promise<void> | void;

export class MemoryHoldWallet implements WalletAdapter {
  private readonly invoices = new Map<string, MemInvoice>();
  private readonly listeners: AcceptedListener[] = [];
  /** Simule une panne du wallet au prochain règlement. */
  failNextSettle = false;

  onAccepted(cb: AcceptedListener): void {
    this.listeners.push(cb);
  }

  invoice(paymentHash: string): Readonly<MemInvoice> | undefined {
    return this.invoices.get(paymentHash);
  }

  async makeHoldInvoice(p: MakeHoldInvoiceParams): Promise<{ bolt11: string }> {
    if (this.invoices.has(p.paymentHash)) throw new Error('INVOICE_EXISTS');
    const sats = p.amountMsat / 1000n;
    const bolt11 = `lnbcrt${sats}n1simulation${p.paymentHash.slice(0, 24)}`;
    this.invoices.set(p.paymentHash, { amountMsat: p.amountMsat, paidMsat: 0n, state: 'OPEN', bolt11 });
    return { bolt11 };
  }

  /** Simule le paiement du client : le HTLC arrive et reste bloqué (ACCEPTED). */
  async simulatePayment(paymentHash: string, amountMsat: bigint): Promise<void> {
    const inv = this.invoices.get(paymentHash);
    if (!inv || inv.state !== 'OPEN') throw new Error('INVOICE_NOT_PAYABLE');
    inv.state = 'ACCEPTED';
    inv.paidMsat = amountMsat;
    for (const l of this.listeners) await l(paymentHash, amountMsat);
  }

  async settleHoldInvoice(preimage: string): Promise<void> {
    const inv = this.invoices.get(hashPreimage(preimage));
    if (!inv || inv.state !== 'ACCEPTED') throw new Error('INVOICE_NOT_SETTLEABLE');
    if (this.failNextSettle) {
      this.failNextSettle = false;
      throw new Error('WALLET_UNREACHABLE');
    }
    inv.state = 'SETTLED';
  }

  async cancelHoldInvoice(paymentHash: string): Promise<void> {
    const inv = this.invoices.get(paymentHash);
    // Simulation : après un redémarrage, les factures simulées n'existent plus ; rien à rembourser.
    if (!inv) return;
    if (inv.state === 'SETTLED') throw new Error('INVOICE_ALREADY_SETTLED');
    inv.state = 'CANCELED';
  }

  async lookupInvoice(paymentHash: string): Promise<{ state: HoldInvoiceState; amountPaidMsat: bigint }> {
    const inv = this.invoices.get(paymentHash);
    if (!inv) throw new Error('INVOICE_NOT_FOUND');
    return { state: inv.state, amountPaidMsat: inv.paidMsat };
  }
}

export class MemoryPayoutSender implements PayoutSender {
  readonly sent: Array<{ destination: string; amountMsat: bigint; kind: PayoutKind }> = [];
  readonly failDestinations = new Set<string>();

  async send(p: PayoutRequest): Promise<void> {
    if (this.failDestinations.has(p.destination)) throw new Error('PAYOUT_ROUTE_NOT_FOUND');
    this.sent.push({ destination: p.destination, amountMsat: p.amountMsat, kind: p.kind });
  }
}

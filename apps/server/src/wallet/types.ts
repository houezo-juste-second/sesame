/**
 * Contrat entre le moteur de séquestre et un wallet Lightning (cahier des charges §12.1).
 * Implémentations : MemoryHoldWallet (simulation/tests), LndAdapter (regtest), NwcAdapter (public).
 */
export type HoldInvoiceState = 'OPEN' | 'ACCEPTED' | 'SETTLED' | 'CANCELED';

export interface MakeHoldInvoiceParams {
  paymentHash: string;
  amountMsat: bigint;
  description: string;
  /** Durée pendant laquelle la facture peut être payée. */
  expirySec: number;
  /** Délai CLTV final, en blocs : durée maximale pendant laquelle le paiement peut rester bloqué. */
  cltvExpiryBlocks: number;
}

export interface WalletAdapter {
  makeHoldInvoice(p: MakeHoldInvoiceParams): Promise<{ bolt11: string }>;
  settleHoldInvoice(preimage: string): Promise<void>;
  cancelHoldInvoice(paymentHash: string): Promise<void>;
  lookupInvoice(paymentHash: string): Promise<{ state: HoldInvoiceState; amountPaidMsat: bigint }>;
}

export type PayoutKind = 'courier' | 'service_fee';

export interface PayoutRequest {
  /** Boutique dont le wallet effectue le paiement (mode A : répartition depuis le wallet vendeuse). */
  shopId: string;
  destination: string;
  amountMsat: bigint;
  kind: PayoutKind;
  memo: string;
}

export interface PayoutSender {
  send(p: PayoutRequest): Promise<void>;
}

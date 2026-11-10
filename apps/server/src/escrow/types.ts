import type { OrderState } from '@sesame/core';
import type { PayoutKind } from '../wallet/types.js';

export type PayoutStatus = 'pending' | 'sent' | 'failed';

export interface Payout {
  kind: PayoutKind;
  destination: string;
  amountMsat: bigint;
  status: PayoutStatus;
  attempts: number;
  lastErrorCode?: string | undefined;
}

export interface Order {
  id: string;
  shopId: string;
  itemLabel: string;
  itemXof: number;
  deliveryFeeXof: number;
  deliveryHours: number;
  /** Taux figé à la création. */
  xofPerBtc: number;
  /** Montant payé par le client : article + livraison. */
  amountMsat: bigint;
  /** Part du livreur (incluse dans amountMsat). */
  courierMsat: bigint;
  /** Frais de service Sésame, prélevés sur la part vendeuse à la libération. */
  feeMsat: bigint;
  state: OrderState;
  paymentHash?: string | undefined;
  bolt11?: string | undefined;
  invoiceExpiresAt?: Date | undefined;
  acceptedAt?: Date | undefined;
  htlcExpiresAt?: Date | undefined;
  /** T_exp : seule échéance affichée au client. */
  releaseDeadlineAt?: Date | undefined;
  courierAddress?: string | undefined;
  /** P reçu mais règlement pas encore confirmé par le wallet (à chiffrer au repos). */
  pendingPreimage?: string | undefined;
  /** P après règlement : n'est plus secret, sert de preuve publique de paiement. */
  settledPreimage?: string | undefined;
  payouts: Payout[];
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderStore {
  get(id: string): Promise<Order | undefined>;
  save(order: Order): Promise<void>;
  findByPaymentHash(paymentHash: string): Promise<Order | undefined>;
  /** Commandes qui demandent encore une action du planificateur. */
  listActionable(): Promise<Order[]>;
}

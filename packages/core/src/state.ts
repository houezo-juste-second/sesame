/**
 * Machine à états d'une commande (cf. cahier des charges §9.2).
 * Libellés affichés : BROUILLON, EN ATTENTE PAIEMENT, FONDS BLOQUÉS, EN LIVRAISON,
 * LIBÉRÉE, REMBOURSÉE, EXPIRÉE.
 */
export type OrderState =
  | 'DRAFT'
  | 'AWAITING_PAYMENT'
  | 'FUNDS_LOCKED'
  | 'OUT_FOR_DELIVERY'
  | 'RELEASED'
  | 'REFUNDED'
  | 'EXPIRED';

export type OrderEvent =
  | 'LOCK'
  | 'PAYMENT_ACCEPTED'
  | 'INVOICE_EXPIRED'
  | 'ASSIGN_COURIER'
  | 'RELEASE'
  | 'REFUND';

const TABLE: Record<OrderState, Partial<Record<OrderEvent, OrderState>>> = {
  DRAFT: { LOCK: 'AWAITING_PAYMENT' },
  AWAITING_PAYMENT: { PAYMENT_ACCEPTED: 'FUNDS_LOCKED', INVOICE_EXPIRED: 'EXPIRED' },
  FUNDS_LOCKED: { ASSIGN_COURIER: 'OUT_FOR_DELIVERY', RELEASE: 'RELEASED', REFUND: 'REFUNDED' },
  OUT_FOR_DELIVERY: { RELEASE: 'RELEASED', REFUND: 'REFUNDED' },
  RELEASED: {},
  REFUNDED: {},
  EXPIRED: {},
};

export class InvalidTransitionError extends Error {
  constructor(readonly from: OrderState, readonly event: OrderEvent) {
    super(`INVALID_TRANSITION: ${event} interdit depuis ${from}`);
  }
}

export function transition(from: OrderState, event: OrderEvent): OrderState {
  const to = TABLE[from][event];
  if (!to) throw new InvalidTransitionError(from, event);
  return to;
}

export function isTerminal(state: OrderState): boolean {
  return Object.keys(TABLE[state]).length === 0;
}

export const STATE_LABEL_FR: Record<OrderState, string> = {
  DRAFT: 'Brouillon',
  AWAITING_PAYMENT: 'En attente de paiement',
  FUNDS_LOCKED: 'Paiement sécurisé',
  OUT_FOR_DELIVERY: 'En livraison',
  RELEASED: 'Livrée et payée',
  REFUNDED: 'Remboursée',
  EXPIRED: 'Expirée',
};

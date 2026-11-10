import { describe, it, expect } from 'vitest';
import { transition, isTerminal, type OrderState, type OrderEvent } from '../src/state.js';

describe('machine à états d’une commande', () => {
  const ok: Array<[OrderState, OrderEvent, OrderState]> = [
    ['DRAFT', 'LOCK', 'AWAITING_PAYMENT'],
    ['AWAITING_PAYMENT', 'PAYMENT_ACCEPTED', 'FUNDS_LOCKED'],
    ['AWAITING_PAYMENT', 'INVOICE_EXPIRED', 'EXPIRED'],
    ['FUNDS_LOCKED', 'ASSIGN_COURIER', 'OUT_FOR_DELIVERY'],
    ['FUNDS_LOCKED', 'RELEASE', 'RELEASED'],
    ['FUNDS_LOCKED', 'REFUND', 'REFUNDED'],
    ['OUT_FOR_DELIVERY', 'RELEASE', 'RELEASED'],
    ['OUT_FOR_DELIVERY', 'REFUND', 'REFUNDED'],
  ];

  it.each(ok)('%s --%s--> %s', (from, ev, to) => {
    expect(transition(from, ev)).toBe(to);
  });

  it('refuse toute transition non prévue', () => {
    expect(() => transition('DRAFT', 'RELEASE')).toThrow(/INVALID_TRANSITION/);
    expect(() => transition('AWAITING_PAYMENT', 'RELEASE')).toThrow(/INVALID_TRANSITION/);
    expect(() => transition('AWAITING_PAYMENT', 'REFUND')).toThrow(/INVALID_TRANSITION/);
  });

  it('les états finaux sont définitifs', () => {
    for (const s of ['RELEASED', 'REFUNDED', 'EXPIRED'] as const) {
      expect(isTerminal(s)).toBe(true);
      for (const ev of ['LOCK', 'PAYMENT_ACCEPTED', 'ASSIGN_COURIER', 'RELEASE', 'REFUND', 'INVOICE_EXPIRED'] as const) {
        expect(() => transition(s, ev)).toThrow(/INVALID_TRANSITION/);
      }
    }
    expect(isTerminal('FUNDS_LOCKED')).toBe(false);
  });
});

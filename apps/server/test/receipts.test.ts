import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { generateSesame, hashPreimage } from '@sesame/core';
import { buildReceipt, verifyReceipt, RECEIPT_KIND } from '../src/nostr/receipts.js';
import type { Order } from '../src/escrow/types.js';

function order(over: Partial<Order> = {}): Order {
  const now = new Date('2026-11-18T10:37:12Z');
  return {
    id: '0193f3c2-7a1b-4c2d-8e9f-0123456789ab', shopId: 's', itemLabel: 'Robe de Mme Diallo, 12 rue X', itemXof: 18_000, deliveryFeeXof: 1_500,
    deliveryHours: 6, xofPerBtc: 60_000_000, amountMsat: 1n, courierMsat: 0n, feeMsat: 0n, feeXof: 180, state: 'RELEASED',
    payouts: [], createdAt: now, updatedAt: now, ...over,
  };
}

describe('reçus Nostr', () => {
  const sk = generateSecretKey();

  it('reçu de livraison : signé par la boutique, preuve de paiement incluse', () => {
    const s = generateSesame();
    const ev = buildReceipt(order({ paymentHash: s.paymentHash, settledPreimage: s.preimage }), sk);
    expect(verifyEvent(ev)).toBe(true);
    expect(ev.kind).toBe(RECEIPT_KIND);
    expect(ev.pubkey).toBe(getPublicKey(sk));
    const tag = (n: string) => ev.tags.find((t) => t[0] === n)?.[1];
    expect(tag('outcome')).toBe('released');
    expect(tag('payment_hash')).toBe(s.paymentHash);
    expect(tag('preimage')).toBe(s.preimage);
    expect(tag('amount_xof')).toBe('19500');
    expect(tag('d')).toMatch(/^sesame:receipt:[0-9a-f]{64}$/);
    expect(verifyReceipt(ev)).toEqual({ valid: true, outcome: 'released', proofOfPayment: true });
  });

  it('ne publie aucune donnée personnelle ni identifiant de commande en clair', () => {
    const s = generateSesame();
    const o = order({ paymentHash: s.paymentHash, settledPreimage: s.preimage, courierAddress: 'moussa@wallet.com' });
    const json = JSON.stringify(buildReceipt(o, sk));
    expect(json).not.toContain('Diallo');
    expect(json).not.toContain(o.id);
    expect(json).not.toContain('moussa');
  });

  it('arrondit le montant (500 FCFA) et l’heure', () => {
    const s = generateSesame();
    const ev = buildReceipt(order({ itemXof: 18_100, deliveryFeeXof: 0, paymentHash: s.paymentHash, settledPreimage: s.preimage }), sk);
    expect(ev.tags.find((t) => t[0] === 'amount_xof')?.[1]).toBe('18000');
    expect(ev.created_at % 3600).toBe(0);
  });

  it('reçu de remboursement : pas de preimage', () => {
    const ev = buildReceipt(order({ state: 'REFUNDED', paymentHash: generateSesame().paymentHash }), sk);
    expect(ev.tags.find((t) => t[0] === 'preimage')).toBeUndefined();
    expect(verifyReceipt(ev)).toEqual({ valid: true, outcome: 'refunded', proofOfPayment: false });
  });

  it('détecte une fausse preuve ou une signature altérée', () => {
    const s = generateSesame();
    const ev = buildReceipt(order({ paymentHash: s.paymentHash, settledPreimage: s.preimage }), sk);
    const fakeProof = { ...ev, tags: ev.tags.map((t) => (t[0] === 'preimage' ? ['preimage', generateSesame().preimage] : t)) };
    expect(verifyReceipt(fakeProof).valid).toBe(false);
    const tampered = { ...ev, tags: ev.tags.map((t) => (t[0] === 'amount_xof' ? ['amount_xof', '999999'] : t)) };
    expect(verifyReceipt(tampered).valid).toBe(false);
    expect(hashPreimage(s.preimage)).toBe(s.paymentHash);
  });

  it('refuse de construire un reçu pour une commande non finale', () => {
    expect(() => buildReceipt(order({ state: 'FUNDS_LOCKED' }), sk)).toThrow();
  });
});

import { describe, it, expect } from 'vitest';
import {
  generateSesame,
  hashPreimage,
  verifyPreimage,
  isHex32,
  encodeSesameQr,
  decodeSesameQr,
} from '../src/sesame.js';

describe('sésame (preimage P / hash H)', () => {
  it('génère un secret de 32 octets et son empreinte SHA-256', () => {
    const s = generateSesame();
    expect(s.preimage).toMatch(/^[0-9a-f]{64}$/);
    expect(s.paymentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(s.paymentHash).toBe(hashPreimage(s.preimage));
  });

  it('ne génère jamais deux fois le même secret', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateSesame().preimage));
    expect(seen.size).toBe(200);
  });

  it('calcule le hash attendu sur un vecteur connu (32 octets nuls)', () => {
    expect(hashPreimage('00'.repeat(32))).toBe(
      '66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925',
    );
  });

  it('vérifie un bon sésame et rejette un mauvais', () => {
    const s = generateSesame();
    expect(verifyPreimage(s.preimage, s.paymentHash)).toBe(true);
    expect(verifyPreimage(generateSesame().preimage, s.paymentHash)).toBe(false);
  });

  it('rejette les entrées mal formées sans lever d’exception', () => {
    const s = generateSesame();
    for (const bad of ['', 'zz'.repeat(32), s.preimage.slice(2), s.preimage + '00', s.preimage.toUpperCase() + 'x']) {
      expect(verifyPreimage(bad, s.paymentHash)).toBe(false);
    }
    expect(isHex32(s.preimage)).toBe(true);
    expect(isHex32('abc')).toBe(false);
  });

  it('accepte un hash en majuscules (normalisation)', () => {
    const s = generateSesame();
    expect(verifyPreimage(s.preimage.toUpperCase(), s.paymentHash.toUpperCase())).toBe(true);
  });

  it('encode et décode le QR sésame (commande + secret)', () => {
    const s = generateSesame();
    const qr = encodeSesameQr('0193f3c2-7a1b-7c2d-8e9f-0123456789ab', s.preimage);
    expect(qr.startsWith('sesame:')).toBe(true);
    expect(decodeSesameQr(qr)).toEqual({ orderId: '0193f3c2-7a1b-7c2d-8e9f-0123456789ab', preimage: s.preimage });
  });

  it('refuse un QR qui n’est pas un sésame', () => {
    expect(decodeSesameQr('lightning:lnbc1...')).toBeNull();
    expect(decodeSesameQr('sesame:abc')).toBeNull();
    expect(decodeSesameQr('sesame:id.' + 'zz'.repeat(32))).toBeNull();
  });
});

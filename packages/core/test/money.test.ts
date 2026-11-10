import { describe, it, expect } from 'vitest';
import { xofToMsat, msatToSat, serviceFeeXof, MSAT_PER_BTC } from '../src/money.js';

describe('conversion FCFA → millisatoshis', () => {
  it('un montant égal au taux donne exactement 1 BTC (1e11 msat)', () => {
    expect(xofToMsat(1_000_000, 1_000_000)).toBe(MSAT_PER_BTC);
  });

  it('10 000 FCFA à 60 000 000 FCFA/BTC = 16 666 sats (arrondi au msat inférieur)', () => {
    const msat = xofToMsat(10_000, 60_000_000);
    expect(msat).toBe(16_666_666n);
    expect(msatToSat(msat)).toBe(16_666n);
  });

  it('refuse les montants ou taux non entiers, nuls ou négatifs', () => {
    expect(() => xofToMsat(0, 60_000_000)).toThrow();
    expect(() => xofToMsat(-5, 60_000_000)).toThrow();
    expect(() => xofToMsat(10.5, 60_000_000)).toThrow();
    expect(() => xofToMsat(100, 0)).toThrow();
  });

  it('refuse les montants au-delà du plafond de sécurité (5 000 000 FCFA)', () => {
    expect(() => xofToMsat(5_000_001, 60_000_000)).toThrow(/plafond/);
  });
});

describe('frais de service Sésame : 1 %, min 25 FCFA, max 1 000 FCFA', () => {
  it.each([
    [1_000, 25],
    [2_500, 25],
    [10_000, 100],
    [18_050, 181],
    [100_000, 1_000],
    [500_000, 1_000],
  ])('article de %i FCFA → %i FCFA de frais', (amount, fee) => {
    expect(serviceFeeXof(amount)).toBe(fee);
  });

  it('applique le taux réduit Pro (0,6 %)', () => {
    expect(serviceFeeXof(10_000, { pro: true })).toBe(60);
  });
});

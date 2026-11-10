import { describe, it, expect } from 'vitest';
import { AuditLog, verifyChain } from '../src/audit/log.js';

describe('journal d’audit chaîné par hachage', () => {
  it('chaîne chaque entrée à la précédente', () => {
    const log = new AuditLog();
    const a = log.append({ orderId: 'o1', event: 'ORDER_CREATED', payload: { amountXof: 19_500 } });
    const b = log.append({ orderId: 'o1', event: 'FUNDS_LOCKED', payload: {} });
    expect(a.seq).toBe(1);
    expect(b.prevHash).toBe(a.hash);
    expect(verifyChain(log.entries())).toEqual({ ok: true });
  });

  it('détecte la modification d’une entrée', () => {
    const log = new AuditLog();
    log.append({ orderId: 'o1', event: 'ORDER_CREATED', payload: { amountXof: 19_500 } });
    log.append({ orderId: 'o1', event: 'RELEASED', payload: {} });
    const entries = log.entries();
    entries[0]!.payload = { amountXof: 1 };
    expect(verifyChain(entries)).toEqual({ ok: false, brokenAt: 1 });
  });

  it('détecte la suppression d’une entrée', () => {
    const log = new AuditLog();
    for (const ev of ['A', 'B', 'C']) log.append({ orderId: 'o1', event: ev, payload: {} });
    const entries = log.entries();
    entries.splice(1, 1);
    expect(verifyChain(entries).ok).toBe(false);
  });

  it('refuse d’enregistrer un secret (sésame, jeton, connexion NWC)', () => {
    const log = new AuditLog();
    expect(() => log.append({ orderId: 'o1', event: 'X', payload: { preimage: 'ab' } })).toThrow(/SECRET_IN_AUDIT/);
    expect(() => log.append({ orderId: 'o1', event: 'X', payload: { note: 'nostr+walletconnect://abc' } })).toThrow(/SECRET_IN_AUDIT/);
    expect(() => log.append({ orderId: 'o1', event: 'X', payload: { token: 'x' } })).toThrow(/SECRET_IN_AUDIT/);
  });
});

import { describe, it, expect } from 'vitest';
import { generateSesame } from '@sesame/core';
import { SecretBox } from '../src/security/secretbox.js';
import { openDatabase } from '../src/db/sqlite.js';
import { SqliteOrderStore, SqliteShopStore, SqliteTokenStore, SqliteAuditLog } from '../src/db/stores.js';
import { verifyChain } from '../src/audit/log.js';
import type { Order } from '../src/escrow/types.js';

const box = new SecretBox('11'.repeat(32));

describe('SecretBox (AES-256-GCM)', () => {
  it('chiffre et déchiffre', () => {
    const c = box.seal('secret');
    expect(c).not.toContain('secret');
    expect(box.open(c)).toBe('secret');
  });
  it('deux chiffrements du même texte diffèrent (nonce aléatoire)', () => {
    expect(box.seal('x')).not.toBe(box.seal('x'));
  });
  it('détecte une altération ou une mauvaise clé', () => {
    const c = box.seal('secret');
    const tampered = c.slice(0, -2) + (c.endsWith('AA') ? 'BB' : 'AA');
    expect(() => box.open(tampered)).toThrow();
    expect(() => new SecretBox('22'.repeat(32)).open(c)).toThrow();
  });
  it('refuse une clé maîtresse trop courte', () => {
    expect(() => new SecretBox('abc')).toThrow(/SESAME_MASTER_KEY/);
  });
  it('accepte une longue phrase secrète (valeur générée par l’hébergeur)', () => {
    const k = 'Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0Lw==extra';
    expect(new SecretBox(k).open(new SecretBox(k).seal('ok'))).toBe('ok');
    expect(() => new SecretBox('autre-phrase-secrete-tres-longue-123456').open(new SecretBox(k).seal('ok'))).toThrow();
  });
});

function sampleOrder(over: Partial<Order> = {}): Order {
  const now = new Date('2026-11-18T10:00:00Z');
  return {
    id: '0193f3c2-7a1b-4c2d-8e9f-0123456789ab', shopId: 'shop1', itemLabel: 'Sac', itemXof: 10_000, deliveryFeeXof: 1_000,
    deliveryHours: 6, xofPerBtc: 60_000_000, amountMsat: 18_333_333n, courierMsat: 1_666_666n, feeMsat: 166_666n, feeXof: 100,
    state: 'FUNDS_LOCKED', paymentHash: generateSesame().paymentHash, bolt11: 'lnbcrt1', invoiceExpiresAt: now, acceptedAt: now,
    htlcExpiresAt: now, releaseDeadlineAt: now, payouts: [], createdAt: now, updatedAt: now, ...over,
  };
}

describe('SqliteOrderStore', () => {
  it('fait l’aller-retour (BigInt, dates, optionnels)', async () => {
    const store = new SqliteOrderStore(openDatabase(':memory:'), box);
    const o = sampleOrder();
    await store.save(o);
    expect(await store.get(o.id)).toEqual(o);
    expect(await store.findByPaymentHash(o.paymentHash!)).toEqual(o);
    expect(await store.get('absent')).toBeUndefined();
  });

  it('chiffre le sésame en attente : jamais en clair dans la base', async () => {
    const db = openDatabase(':memory:');
    const store = new SqliteOrderStore(db, box);
    const s = generateSesame();
    const o = sampleOrder({ paymentHash: s.paymentHash, pendingPreimage: s.preimage });
    await store.save(o);
    const raw = JSON.stringify(db.prepare('SELECT * FROM orders').all());
    expect(raw).not.toContain(s.preimage);
    expect((await store.get(o.id))!.pendingPreimage).toBe(s.preimage);
  });

  it('liste par boutique et les commandes à traiter', async () => {
    const store = new SqliteOrderStore(openDatabase(':memory:'), box);
    await store.save(sampleOrder({ id: 'a', state: 'FUNDS_LOCKED', createdAt: new Date('2026-11-18T10:00:00Z') }));
    await store.save(sampleOrder({ id: 'b', state: 'RELEASED', paymentHash: generateSesame().paymentHash, createdAt: new Date('2026-11-18T11:00:00Z') }));
    await store.save(sampleOrder({ id: 'c', state: 'DRAFT', paymentHash: undefined, shopId: 'shop2' }));
    await store.save(sampleOrder({
      id: 'd', state: 'RELEASED', paymentHash: generateSesame().paymentHash,
      payouts: [{ kind: 'courier', destination: 'x@y.com', amountMsat: 1n, status: 'pending', attempts: 1 }],
    }));
    const ids = (await store.listByShop('shop1')).map((o) => o.id);
    expect(ids[0]).toBe('b'); // la plus récente d'abord
    expect([...ids].sort()).toEqual(['a', 'b', 'd']);
    expect((await store.listActionable()).map((o) => o.id).sort()).toEqual(['a', 'd']);
  });

  it('survit à une réouverture de la base (fichier)', async () => {
    const path = `${process.env.TEMP ?? '/tmp'}/sesame-test-${Date.now()}.sqlite`;
    const o = sampleOrder();
    await new SqliteOrderStore(openDatabase(path), box).save(o);
    expect(await new SqliteOrderStore(openDatabase(path), box).get(o.id)).toEqual(o);
  });
});

describe('boutiques, jetons et audit en SQLite', () => {
  it('boutique : création, slug unique, clé Nostr chiffrée', () => {
    const db = openDatabase(':memory:');
    const shops = new SqliteShopStore(db, box);
    const a = shops.create({ name: 'Pagnes de Fifamè', city: 'Cotonou', pinHash: 'h' });
    const b = shops.create({ name: 'Pagnes de Fifamè', city: 'Cotonou', pinHash: 'h' });
    expect(a.slug).toBe('pagnes-de-fifame');
    expect(b.slug).toBe('pagnes-de-fifame-2');
    expect(shops.bySlug('pagnes-de-fifame')?.id).toBe(a.id);
    expect(a.nostrPubkey).toMatch(/^[0-9a-f]{64}$/);
    expect(shops.nostrSecretKey(a.id)).toHaveLength(32);
    expect(JSON.stringify(db.prepare('SELECT * FROM shops').all())).not.toMatch(/"nostr_seckey":"[0-9a-f]{64}"/);
  });

  it('jetons : seul le hachage est stocké', () => {
    const db = openDatabase(':memory:');
    const tokens = new SqliteTokenStore(db);
    const t = tokens.issue({ role: 'client', shopId: 's', orderId: 'o' });
    expect(tokens.resolve(t)).toEqual({ role: 'client', shopId: 's', orderId: 'o' });
    expect(tokens.resolve('inconnu')).toBeUndefined();
    expect(JSON.stringify(db.prepare('SELECT * FROM tokens').all())).not.toContain(t);
  });

  it('audit : la chaîne persistée reste vérifiable et continue après réouverture', () => {
    const db = openDatabase(':memory:');
    const log = new SqliteAuditLog(db);
    log.append({ orderId: 'o', event: 'ORDER_CREATED', payload: { amountXof: 1 } });
    new SqliteAuditLog(db).append({ orderId: 'o', event: 'RELEASED', payload: {} });
    const entries = new SqliteAuditLog(db).entries();
    expect(entries).toHaveLength(2);
    expect(verifyChain(entries)).toEqual({ ok: true });
  });
});

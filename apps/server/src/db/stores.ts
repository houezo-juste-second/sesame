/** Implémentations SQLite des stockages : commandes, boutiques, jetons, journal d'audit, événements Nostr. */
import { randomUUID } from 'node:crypto';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import type { Order, OrderStore } from '../escrow/types.js';
import { assertNoSecret, digest, GENESIS, type AuditEntry, type AuditInput, type AuditValue } from '../audit/log.js';
import { hashToken, newToken, type Grant, type Role, type TokenRegistry } from '../auth.js';
import type { SecretBox } from '../security/secretbox.js';
import { slugify, type Shop, type ShopStore } from '../shops.js';
import type { Db } from './sqlite.js';

// ---------------------------------------------------------------- sérialisation (BigInt, Date)

function encode(value: unknown): string {
  return JSON.stringify(value, function (this: Record<string, unknown>, key, v) {
    const raw = this[key];
    if (typeof raw === 'bigint') return { $big: raw.toString() };
    if (raw instanceof Date) return { $date: raw.toISOString() };
    return v;
  });
}

function decode<T>(text: string): T {
  return JSON.parse(text, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (typeof v.$big === 'string') return BigInt(v.$big);
      if (typeof v.$date === 'string') return new Date(v.$date);
    }
    return v;
  }) as T;
}

const TERMINAL = "('DRAFT','RELEASED','REFUNDED','EXPIRED')";

// ---------------------------------------------------------------- commandes

interface OrderRow { data: string; pending_preimage: string | null }

export class SqliteOrderStore implements OrderStore {
  constructor(private readonly db: Db, private readonly box: SecretBox) {}

  private toOrder(row: OrderRow | undefined): Order | undefined {
    if (!row) return undefined;
    const o = decode<Order>(row.data);
    if (row.pending_preimage) o.pendingPreimage = this.box.open(row.pending_preimage);
    return o;
  }

  async get(id: string): Promise<Order | undefined> {
    return this.toOrder(this.db.prepare('SELECT data, pending_preimage FROM orders WHERE id = ?').get(id) as OrderRow | undefined);
  }

  async save(order: Order): Promise<void> {
    const { pendingPreimage, ...rest } = order;
    this.db
      .prepare(
        `INSERT INTO orders (id, shop_id, state, payment_hash, created_at, has_pending_payout, pending_preimage, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET state = excluded.state, payment_hash = excluded.payment_hash,
           has_pending_payout = excluded.has_pending_payout, pending_preimage = excluded.pending_preimage, data = excluded.data`,
      )
      .run(
        order.id,
        order.shopId,
        order.state,
        order.paymentHash ?? null,
        order.createdAt.toISOString(),
        order.payouts.some((p) => p.status === 'pending') ? 1 : 0,
        pendingPreimage ? this.box.seal(pendingPreimage) : null,
        encode(rest),
      );
  }

  async findByPaymentHash(paymentHash: string): Promise<Order | undefined> {
    return this.toOrder(this.db.prepare('SELECT data, pending_preimage FROM orders WHERE payment_hash = ?').get(paymentHash) as OrderRow | undefined);
  }

  async listByShop(shopId: string): Promise<Order[]> {
    const rows = this.db.prepare('SELECT data, pending_preimage FROM orders WHERE shop_id = ? ORDER BY created_at DESC LIMIT 500').all(shopId) as unknown as OrderRow[];
    return rows.map((r) => this.toOrder(r)!);
  }

  async listActionable(): Promise<Order[]> {
    const rows = this.db
      .prepare(`SELECT data, pending_preimage FROM orders WHERE state NOT IN ${TERMINAL} OR has_pending_payout = 1`)
      .all() as unknown as OrderRow[];
    return rows.map((r) => this.toOrder(r)!);
  }
}

// ---------------------------------------------------------------- boutiques

interface ShopRow { id: string; slug: string; name: string; city: string; pin_hash: string; nostr_pubkey: string; created_at: string }

export class SqliteShopStore implements ShopStore {
  constructor(private readonly db: Db, private readonly box: SecretBox) {}

  private toShop(r: ShopRow | undefined): Shop | undefined {
    return r && { id: r.id, slug: r.slug, name: r.name, city: r.city, pinHash: r.pin_hash, nostrPubkey: r.nostr_pubkey, createdAt: new Date(r.created_at) };
  }

  create(input: { name: string; city: string; pinHash: string }): Shop {
    const base = slugify(input.name);
    let slug = base;
    for (let i = 2; this.db.prepare('SELECT 1 FROM shops WHERE slug = ?').get(slug); i++) slug = `${base}-${i}`;
    const sk = generateSecretKey();
    const shop: Shop = { id: randomUUID(), slug, name: input.name, city: input.city, pinHash: input.pinHash, nostrPubkey: getPublicKey(sk), createdAt: new Date() };
    this.db
      .prepare('INSERT INTO shops (id, slug, name, city, pin_hash, nostr_pubkey, nostr_seckey, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(shop.id, shop.slug, shop.name, shop.city, shop.pinHash, shop.nostrPubkey, this.box.seal(bytesToHex(sk)), shop.createdAt.toISOString());
    return shop;
  }

  get(id: string): Shop | undefined {
    return this.toShop(this.db.prepare('SELECT * FROM shops WHERE id = ?').get(id) as ShopRow | undefined);
  }

  bySlug(slug: string): Shop | undefined {
    return this.toShop(this.db.prepare('SELECT * FROM shops WHERE slug = ?').get(slug) as ShopRow | undefined);
  }

  nostrSecretKey(id: string): Uint8Array {
    const r = this.db.prepare('SELECT nostr_seckey FROM shops WHERE id = ?').get(id) as { nostr_seckey: string } | undefined;
    if (!r) throw new Error('SHOP_NOT_FOUND');
    return hexToBytes(this.box.open(r.nostr_seckey));
  }
}

// ---------------------------------------------------------------- jetons

export class SqliteTokenStore implements TokenRegistry {
  constructor(private readonly db: Db) {}

  issue(grant: Grant): string {
    const token = newToken();
    this.db
      .prepare('INSERT INTO tokens (hash, role, shop_id, order_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(hashToken(token), grant.role, grant.shopId, grant.orderId ?? null, new Date().toISOString());
    return token;
  }

  resolve(token: string | undefined): Grant | undefined {
    if (!token || token.length > 64) return undefined;
    const r = this.db.prepare('SELECT role, shop_id, order_id FROM tokens WHERE hash = ?').get(hashToken(token)) as
      | { role: Role; shop_id: string; order_id: string | null }
      | undefined;
    if (!r) return undefined;
    return r.order_id ? { role: r.role, shopId: r.shop_id, orderId: r.order_id } : { role: r.role, shopId: r.shop_id };
  }
}

// ---------------------------------------------------------------- journal d'audit

export class SqliteAuditLog {
  constructor(private readonly db: Db, private readonly clock: () => Date = () => new Date()) {}

  append(input: AuditInput): AuditEntry {
    assertNoSecret(input.payload);
    const prev = this.db.prepare('SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1').get() as { seq: number; hash: string } | undefined;
    const base = {
      seq: (prev?.seq ?? 0) + 1,
      at: this.clock().toISOString(),
      orderId: input.orderId,
      event: input.event,
      payload: { ...input.payload },
      prevHash: prev?.hash ?? GENESIS,
    };
    const entry: AuditEntry = { ...base, hash: digest(base) };
    this.db
      .prepare('INSERT INTO audit_log (seq, at, order_id, event, payload, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(entry.seq, entry.at, entry.orderId, entry.event, JSON.stringify(entry.payload), entry.prevHash, entry.hash);
    return entry;
  }

  entries(): AuditEntry[] {
    const rows = this.db.prepare('SELECT * FROM audit_log ORDER BY seq').all() as Array<{
      seq: number; at: string; order_id: string; event: string; payload: string; prev_hash: string; hash: string;
    }>;
    return rows.map((r) => ({
      seq: r.seq, at: r.at, orderId: r.order_id, event: r.event,
      payload: JSON.parse(r.payload) as Record<string, AuditValue>, prevHash: r.prev_hash, hash: r.hash,
    }));
  }
}

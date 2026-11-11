/**
 * Base SQLite intégrée à Node.js (node:sqlite) : aucune dépendance, aucune compilation native.
 * Migrations versionnées par PRAGMA user_version.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE shops (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    city TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    nostr_pubkey TEXT NOT NULL,
    nostr_seckey TEXT NOT NULL,          -- chiffrée (SecretBox)
    created_at TEXT NOT NULL
  );
  CREATE TABLE orders (
    id TEXT PRIMARY KEY,
    shop_id TEXT NOT NULL,
    state TEXT NOT NULL,
    payment_hash TEXT UNIQUE,
    created_at TEXT NOT NULL,
    has_pending_payout INTEGER NOT NULL DEFAULT 0,
    pending_preimage TEXT,               -- chiffré (SecretBox)
    data TEXT NOT NULL
  );
  CREATE INDEX orders_by_shop ON orders(shop_id, created_at DESC);
  CREATE INDEX orders_by_state ON orders(state);
  CREATE TABLE tokens (
    hash TEXT PRIMARY KEY,               -- SHA-256 du jeton, jamais le jeton
    role TEXT NOT NULL,
    shop_id TEXT NOT NULL,
    order_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE audit_log (
    seq INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    order_id TEXT NOT NULL,
    event TEXT NOT NULL,
    payload TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL
  );
  CREATE TABLE nostr_events (
    event_id TEXT PRIMARY KEY,
    shop_id TEXT NOT NULL,
    d_tag TEXT NOT NULL UNIQUE,
    json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    relays_ok INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX nostr_by_shop ON nostr_events(shop_id, created_at DESC);
  `,
];

export type Db = DatabaseSync;

export function openDatabase(file: string): Db {
  if (file !== ':memory:') mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}

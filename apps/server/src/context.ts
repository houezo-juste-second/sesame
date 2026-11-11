/**
 * Assemblage des dépendances du serveur.
 * - Stockage : SQLite (fichier, ou « :memory: » pour les tests).
 * - Wallet   : simulation pour l'instant (AUCUN argent réel, signalé à l'écran).
 * - Nostr    : reçus signés stockés ; publication sur relais publics si activée.
 */
import type { LlmConfig } from './ai/extract.js';
import type { TokenRegistry } from './auth.js';
import { openDatabase, type Db } from './db/sqlite.js';
import { SqliteAuditLog, SqliteOrderStore, SqliteShopStore, SqliteTokenStore } from './db/stores.js';
import { EscrowEngine } from './escrow/engine.js';
import type { OrderStore } from './escrow/types.js';
import { EventHub } from './events.js';
import { PoolPublisher, ReceiptService, type RelayPublisher } from './nostr/receipts.js';
import { FixedRate, MempoolRate, type RateProvider } from './rate.js';
import { SecretBox } from './security/secretbox.js';
import type { ShopStore } from './shops.js';
import { MemoryHoldWallet, MemoryPayoutSender } from './wallet/memory.js';

export interface ServerConfig {
  mode: 'simulation';
  /** Chemin de la base SQLite ; « :memory: » par défaut (tests). */
  dbPath?: string | undefined;
  /** Clé maîtresse (64 hex) ; absente : clé éphémère (les secrets en attente ne survivent pas au redémarrage → remboursement, sûr). */
  masterKey?: string | undefined;
  /** Taux fixe (tests, démo hors ligne). Absent : taux réel via mempool.space. */
  fixedXofPerBtc?: number | undefined;
  llm?: LlmConfig | undefined;
  /** Relais Nostr où publier les reçus ; vide : reçus signés et stockés, non publiés. */
  nostrRelays?: string[] | undefined;
  /** Remplace le publieur (tests). */
  publisher?: RelayPublisher | undefined;
  onError?: ((e: unknown) => void) | undefined;
}

export interface ServerContext {
  config: ServerConfig;
  db: Db;
  engine: EscrowEngine;
  store: OrderStore;
  shops: ShopStore;
  tokens: TokenRegistry;
  rate: RateProvider;
  hub: EventHub;
  audit: SqliteAuditLog;
  receipts: ReceiptService;
  /** Présent uniquement en mode simulation : permet le « wallet de démo ». */
  simWallet?: MemoryHoldWallet | undefined;
}

export function createServerContext(config: ServerConfig): ServerContext {
  const db = openDatabase(config.dbPath ?? ':memory:');
  const box = config.masterKey ? new SecretBox(config.masterKey) : SecretBox.random();
  const store = new SqliteOrderStore(db, box);
  const shops = new SqliteShopStore(db, box);
  const hub = new EventHub();
  const audit = new SqliteAuditLog(db);
  const wallet = new MemoryHoldWallet();
  const payouts = new MemoryPayoutSender();
  const publisher = config.publisher ?? (config.nostrRelays?.length ? new PoolPublisher(config.nostrRelays) : null);
  const receipts = new ReceiptService(db, store, shops, publisher, config.onError);

  const engine = new EscrowEngine({
    walletFor: () => wallet,
    payouts,
    store,
    onEvent: (e) => {
      audit.append({ orderId: e.orderId, event: e.type, payload: { state: e.state, ...(e.data ?? {}) } });
      hub.publish(e, e.shopId);
      if (e.type === 'RELEASED' || e.type === 'REFUNDED') receipts.onFinal(e.orderId);
    },
  });
  wallet.onAccepted((hash, amount) => engine.handleInvoiceAccepted(hash, amount));

  const rate: RateProvider = config.fixedXofPerBtc ? new FixedRate(config.fixedXofPerBtc) : new MempoolRate(60_000_000);

  return {
    config,
    db,
    engine,
    store,
    shops,
    tokens: new SqliteTokenStore(db),
    rate,
    hub,
    audit,
    receipts,
    simWallet: wallet,
  };
}

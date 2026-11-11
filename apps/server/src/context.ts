/**
 * Assemblage des dépendances du serveur selon le mode :
 * - simulation : wallet en mémoire, AUCUN argent réel (signalé à l'écran) ;
 * - lnd        : nœud LND réel (regtest / mutinynet) — adaptateur à brancher.
 */
import { AuditLog } from './audit/log.js';
import { TokenStore } from './auth.js';
import { EscrowEngine } from './escrow/engine.js';
import { MemoryOrderStore } from './escrow/store.js';
import type { OrderStore } from './escrow/types.js';
import { EventHub } from './events.js';
import { FixedRate, MempoolRate, type RateProvider } from './rate.js';
import { MemoryShopStore } from './shops.js';
import type { LlmConfig } from './ai/extract.js';
import { MemoryHoldWallet, MemoryPayoutSender } from './wallet/memory.js';

export interface ServerConfig {
  mode: 'simulation';
  /** Taux fixe (tests, démo hors ligne). Absent : taux réel via mempool.space. */
  fixedXofPerBtc?: number | undefined;
  llm?: LlmConfig | undefined;
}

export interface ServerContext {
  config: ServerConfig;
  engine: EscrowEngine;
  store: OrderStore;
  shops: MemoryShopStore;
  tokens: TokenStore;
  rate: RateProvider;
  hub: EventHub;
  audit: AuditLog;
  /** Présent uniquement en mode simulation : permet le « wallet de démo ». */
  simWallet?: MemoryHoldWallet | undefined;
}

export function createServerContext(config: ServerConfig): ServerContext {
  const store = new MemoryOrderStore();
  const hub = new EventHub();
  const audit = new AuditLog();
  const wallet = new MemoryHoldWallet();
  const payouts = new MemoryPayoutSender();

  const engine = new EscrowEngine({
    walletFor: () => wallet,
    payouts,
    store,
    onEvent: (e) => {
      audit.append({ orderId: e.orderId, event: e.type, payload: { state: e.state, ...(e.data ?? {}) } });
      hub.publish(e, e.shopId);
    },
  });
  wallet.onAccepted((hash, amount) => engine.handleInvoiceAccepted(hash, amount));

  const rate: RateProvider = config.fixedXofPerBtc
    ? new FixedRate(config.fixedXofPerBtc)
    : new MempoolRate(60_000_000);

  return {
    config,
    engine,
    store,
    shops: new MemoryShopStore(),
    tokens: new TokenStore(),
    rate,
    hub,
    audit,
    simWallet: wallet,
  };
}

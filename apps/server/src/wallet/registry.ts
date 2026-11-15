/**
 * Wallets des boutiques : NWC (wallet réel de la vendeuse) si elle l'a branché, sinon simulation.
 * Les codes de connexion NWC sont chiffrés en base et ne sont jamais renvoyés par l'API ni journalisés.
 */
import type { ShopStore } from '../shops.js';
import type { OrderStore } from '../escrow/types.js';
import { MemoryHoldWallet, MemoryPayoutSender } from './memory.js';
import { invoiceForLightningAddress, NwcClient, NwcHoldWallet, parseNwcUri, PoolTransport, type NwcInfo, type NwcTransport } from './nwc.js';
import type { PayoutRequest, PayoutSender, WalletAdapter } from './types.js';

type AcceptedHandler = (paymentHash: string, amountPaidMsat: bigint) => Promise<void>;

export interface WalletRegistryOptions {
  transport?: NwcTransport | undefined;
  timeoutMs?: number | undefined;
  fetch?: typeof fetch | undefined;
  onError?: ((e: unknown) => void) | undefined;
}

export class WalletRegistry {
  readonly sim = new MemoryHoldWallet();
  readonly simPayouts = new MemoryPayoutSender();
  private readonly nwc = new Map<string, NwcHoldWallet>();
  private transport: NwcTransport | undefined;
  private onAcceptedHandler: AcceptedHandler = async () => {};

  constructor(private readonly shops: ShopStore, private readonly opts: WalletRegistryOptions = {}) {
    this.transport = opts.transport;
  }

  private getTransport(): NwcTransport {
    return (this.transport ??= new PoolTransport());
  }

  /** Le moteur est prévenu quand un client a payé (wallet simulé ou wallet réel). */
  onAccepted(handler: AcceptedHandler): void {
    this.onAcceptedHandler = handler;
    this.sim.onAccepted(handler);
  }

  walletFor(shopId: string): WalletAdapter {
    return this.nwc.get(shopId) ?? this.sim;
  }

  isConnected(shopId: string): boolean {
    return this.nwc.has(shopId);
  }

  private build(uri: string): NwcHoldWallet {
    const w = new NwcHoldWallet(new NwcClient(parseNwcUri(uri), this.getTransport(), this.opts.timeoutMs));
    w.onAccepted((h, a) => this.onAcceptedHandler(h, a));
    return w;
  }

  /** Reconnecte au démarrage les wallets déjà branchés. */
  restore(): void {
    for (const id of this.shops.withWallet()) {
      try {
        const uri = this.shops.getWallet(id);
        if (uri) this.nwc.set(id, this.build(uri));
      } catch (e) {
        this.opts.onError?.(e);
      }
    }
  }

  /** Vérifie le wallet (factures hold prises en charge) avant de l'enregistrer. */
  async connect(shopId: string, uri: string): Promise<NwcInfo & { lud16?: string | undefined }> {
    const conn = parseNwcUri(uri);
    const w = this.build(uri);
    let info: NwcInfo;
    try {
      info = await w.check();
    } catch (e) {
      w.close();
      throw e;
    }
    this.shops.setWallet(shopId, uri.trim());
    this.nwc.get(shopId)?.close();
    this.nwc.set(shopId, w);
    return { ...info, lud16: conn.lud16 };
  }

  disconnect(shopId: string): void {
    this.nwc.get(shopId)?.close();
    this.nwc.delete(shopId);
    this.shops.setWallet(shopId, null);
  }

  /** Filet de sécurité si une notification se perd : interroge le wallet pour les factures en attente. */
  private polling = false;

  async pollPending(store: OrderStore): Promise<void> {
    if (this.polling) return; // une seule vérification à la fois
    this.polling = true;
    try {
      await this.pollOnce(store);
    } finally {
      this.polling = false;
    }
  }

  private async pollOnce(store: OrderStore): Promise<void> {
    for (const o of await store.listActionable()) {
      if (o.state !== 'AWAITING_PAYMENT' || o.walletKind !== 'nwc' || !o.paymentHash) continue;
      const w = this.nwc.get(o.shopId);
      if (!w) continue;
      try {
        const r = await w.lookupInvoice(o.paymentHash);
        if (r.state === 'ACCEPTED') await this.onAcceptedHandler(o.paymentHash, r.amountPaidMsat);
      } catch (e) {
        this.opts.onError?.(e);
      }
    }
  }

  /** Paiements après libération : depuis le wallet réel de la vendeuse, ou simulés. */
  payouts(): PayoutSender {
    return {
      send: async (p: PayoutRequest) => {
        const w = this.nwc.get(p.shopId);
        if (!w) return this.simPayouts.send(p);
        // Frais Sésame : comptabilisés, pas encore prélevés (aucune adresse de frais configurée).
        if (p.destination.endsWith('@sesame.local')) return;
        if (p.destination.startsWith('momo:')) return this.simPayouts.send(p);
        const bolt11 = await invoiceForLightningAddress(p.destination, p.amountMsat, p.memo, this.opts.fetch);
        await w.payInvoice(bolt11);
      },
    };
  }
}

/**
 * Nostr Wallet Connect (NIP-47) : la vendeuse branche SON wallet Lightning (ex. Alby Hub).
 * Les fonds restent dans le wallet de la vendeuse. Sésame détient seulement une clé de connexion (chiffrée)
 * qui lui permet d'envoyer des requêtes (créer / régler / annuler une facture hold, payer le livreur),
 * dans les limites (budget, méthodes autorisées) que la vendeuse fixe dans son wallet.
 *
 * Méthodes hold : make_hold_invoice, settle_hold_invoice, cancel_hold_invoice,
 * notification hold_invoice_accepted (proposition NIP-47 « hold invoices », prise en charge par Alby Hub).
 */
import { finalizeEvent, getPublicKey, verifyEvent, type Event } from 'nostr-tools/pure';
import type { Filter } from 'nostr-tools/filter';
import * as nip04 from 'nostr-tools/nip04';
import * as nip44 from 'nostr-tools/nip44';
import { SimplePool } from 'nostr-tools/pool';
import { hexToBytes } from '@noble/hashes/utils.js';
import type { HoldInvoiceState, MakeHoldInvoiceParams, WalletAdapter } from './types.js';

export const NWC_REQUEST = 23194;
export const NWC_RESPONSE = 23195;
export const NWC_NOTIFICATION_NIP04 = 23196;
export const NWC_NOTIFICATION_NIP44 = 23197;
export const NWC_INFO = 13194;

const HEX64 = /^[0-9a-f]{64}$/;

export interface NwcConnection {
  walletPubkey: string;
  relays: string[];
  secret: string;
  lud16?: string | undefined;
}

export class NwcError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/** nostr+walletconnect://<pubkey>?relay=wss://…&secret=<hex>[&lud16=…] */
export function parseNwcUri(uri: string): NwcConnection {
  const raw = uri.trim();
  const m = /^nostr\+walletconnect:\/\/([0-9a-fA-F]{64})\?(.+)$/.exec(raw);
  if (!m) throw new NwcError('INVALID_URI', 'Code de connexion invalide : il doit commencer par nostr+walletconnect://');
  const params = new URLSearchParams(m[2]!);
  const secret = (params.get('secret') ?? '').toLowerCase();
  const relays = params.getAll('relay').map((r) => r.trim()).filter((r) => /^wss:\/\/[^\s]+$/.test(r));
  if (!HEX64.test(secret)) throw new NwcError('INVALID_URI', 'Code de connexion invalide : secret manquant.');
  if (relays.length === 0) throw new NwcError('INVALID_URI', 'Code de connexion invalide : aucun relais sécurisé (wss://).');
  const lud16 = params.get('lud16') ?? undefined;
  return { walletPubkey: m[1]!.toLowerCase(), relays: [...new Set(relays)].slice(0, 5), secret, ...(lud16 ? { lud16 } : {}) };
}

// ------------------------------------------------------------------ transport (relais Nostr)

export interface NwcTransport {
  publish(relays: string[], ev: Event): Promise<void>;
  subscribe(relays: string[], filter: Filter, onEvent: (ev: Event) => void): () => void;
}

export class PoolTransport implements NwcTransport {
  private readonly pool = new SimplePool();

  async publish(relays: string[], ev: Event): Promise<void> {
    await Promise.any(this.pool.publish(relays, ev));
  }

  subscribe(relays: string[], filter: Filter, onEvent: (ev: Event) => void): () => void {
    const sub = this.pool.subscribeMany(relays, filter, { onevent: onEvent });
    return () => sub.close();
  }
}

// ------------------------------------------------------------------ client NIP-47

type Encryption = 'nip44_v2' | 'nip04';

export interface NwcInfo { methods: string[]; notifications: string[]; encryption: Encryption }

export class NwcClient {
  private readonly sk: Uint8Array;
  readonly clientPubkey: string;
  private encryption: Encryption | undefined;
  private readonly closers: Array<() => void> = [];

  constructor(readonly conn: NwcConnection, private readonly transport: NwcTransport, private readonly timeoutMs = 20_000) {
    this.sk = hexToBytes(conn.secret);
    this.clientPubkey = getPublicKey(this.sk);
  }

  private seal(text: string, enc: Encryption): string {
    return enc === 'nip44_v2'
      ? nip44.encrypt(text, nip44.getConversationKey(this.sk, this.conn.walletPubkey))
      : nip04.encrypt(this.sk, this.conn.walletPubkey, text);
  }

  private open(payload: string, enc: Encryption): string {
    return enc === 'nip44_v2'
      ? nip44.decrypt(payload, nip44.getConversationKey(this.sk, this.conn.walletPubkey))
      : nip04.decrypt(this.sk, this.conn.walletPubkey, payload);
  }

  /** Lit l'événement d'information du wallet (méthodes, notifications, chiffrement). */
  async info(): Promise<NwcInfo> {
    const ev = await new Promise<Event | undefined>((resolve) => {
      const timer = setTimeout(() => { close(); resolve(undefined); }, Math.min(this.timeoutMs, 8_000));
      const close = this.transport.subscribe(this.conn.relays, { kinds: [NWC_INFO], authors: [this.conn.walletPubkey], limit: 1 }, (e) => {
        if (!verifyEvent(e)) return;
        clearTimeout(timer);
        close();
        resolve(e);
      });
    });
    if (!ev) throw new NwcError('WALLET_UNREACHABLE', 'Le wallet ne répond pas sur ses relais. Vérifiez qu’il est allumé et connecté.');
    const tag = (name: string) => ev.tags.find((t) => t[0] === name)?.[1] ?? '';
    const encryption: Encryption = tag('encryption').split(/\s+/).includes('nip44_v2') ? 'nip44_v2' : 'nip04';
    this.encryption = encryption;
    return { methods: ev.content.split(/\s+/).filter(Boolean), notifications: tag('notifications').split(/\s+/).filter(Boolean), encryption };
  }

  async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const enc = this.encryption ?? (await this.info()).encryption;
    const now = Math.floor(Date.now() / 1000);
    const ev = finalizeEvent({
      kind: NWC_REQUEST,
      created_at: now,
      tags: [['p', this.conn.walletPubkey], ['expiration', String(now + 60)], ...(enc === 'nip44_v2' ? [['encryption', 'nip44_v2']] : [])],
      content: this.seal(JSON.stringify({ method, params }), enc),
    }, this.sk);

    return new Promise<T>((resolve, reject) => {
      let close = () => {};
      const timer = setTimeout(() => { close(); reject(new NwcError('WALLET_TIMEOUT', 'Le wallet de la vendeuse ne répond pas. Réessayez dans un instant.')); }, this.timeoutMs);
      close = this.transport.subscribe(this.conn.relays, { kinds: [NWC_RESPONSE], authors: [this.conn.walletPubkey], '#e': [ev.id] }, (res) => {
        if (!verifyEvent(res) || !res.tags.some((t) => t[0] === 'e' && t[1] === ev.id)) return;
        clearTimeout(timer);
        close();
        try {
          const body = JSON.parse(this.open(res.content, enc)) as { result?: T; error?: { code?: string; message?: string } | null };
          if (body.error) reject(new NwcError(body.error.code ?? 'WALLET_ERROR', body.error.message ?? 'Erreur du wallet.'));
          else resolve(body.result as T);
        } catch {
          reject(new NwcError('WALLET_BAD_RESPONSE', 'Réponse du wallet illisible.'));
        }
      });
      this.transport.publish(this.conn.relays, ev).catch(() => {
        clearTimeout(timer);
        close();
        reject(new NwcError('WALLET_UNREACHABLE', 'Impossible de joindre les relais du wallet.'));
      });
    });
  }

  /** Notifications du wallet (NIP-04 et NIP-44). */
  onNotification(cb: (type: string, data: Record<string, unknown>) => void): void {
    const close = this.transport.subscribe(this.conn.relays, {
      kinds: [NWC_NOTIFICATION_NIP04, NWC_NOTIFICATION_NIP44], authors: [this.conn.walletPubkey], '#p': [this.clientPubkey],
      since: Math.floor(Date.now() / 1000) - 60,
    }, (ev) => {
      if (!verifyEvent(ev)) return;
      try {
        const body = JSON.parse(this.open(ev.content, ev.kind === NWC_NOTIFICATION_NIP44 ? 'nip44_v2' : 'nip04')) as {
          notification_type?: string; notification?: Record<string, unknown>;
        };
        if (body.notification_type && body.notification) cb(body.notification_type, body.notification);
      } catch { /* notification illisible : ignorée */ }
    });
    this.closers.push(close);
  }

  close(): void {
    for (const c of this.closers.splice(0)) c();
  }
}

// ------------------------------------------------------------------ wallet de la vendeuse

type AcceptedListener = (paymentHash: string, amountPaidMsat: bigint) => Promise<void> | void;

interface NwcTransaction { invoice?: string; amount?: number; state?: string; settled_at?: number | null }

export const REQUIRED_METHODS = ['make_hold_invoice', 'settle_hold_invoice', 'cancel_hold_invoice'];

export class NwcHoldWallet implements WalletAdapter {
  private readonly listeners: AcceptedListener[] = [];

  constructor(readonly client: NwcClient) {
    client.onNotification((type, n) => {
      if (type !== 'hold_invoice_accepted') return;
      const hash = String(n.payment_hash ?? '').toLowerCase();
      if (!HEX64.test(hash)) return;
      const amount = BigInt(Math.max(0, Math.trunc(Number(n.amount ?? 0))));
      for (const l of this.listeners) void l(hash, amount);
    });
  }

  onAccepted(cb: AcceptedListener): void {
    this.listeners.push(cb);
  }

  /** Vérifie que le wallet sait gérer des factures hold. */
  async check(): Promise<NwcInfo> {
    const info = await this.client.info();
    const missing = REQUIRED_METHODS.filter((m) => !info.methods.includes(m));
    if (missing.length) {
      throw new NwcError('HOLD_UNSUPPORTED', 'Ce wallet ne gère pas les factures « hold ». Utilisez un wallet compatible (ex. Alby Hub à jour).');
    }
    return info;
  }

  async makeHoldInvoice(p: MakeHoldInvoiceParams): Promise<{ bolt11: string }> {
    const r = await this.client.request<NwcTransaction>('make_hold_invoice', {
      amount: Number(p.amountMsat),
      payment_hash: p.paymentHash,
      description: p.description,
      expiry: p.expirySec,
      min_cltv_expiry_delta: p.cltvExpiryBlocks,
    });
    if (!r?.invoice || !/^ln/i.test(r.invoice)) throw new NwcError('WALLET_BAD_RESPONSE', 'Le wallet n’a pas renvoyé de facture.');
    return { bolt11: r.invoice };
  }

  async settleHoldInvoice(preimage: string): Promise<void> {
    await this.client.request('settle_hold_invoice', { preimage });
  }

  async cancelHoldInvoice(paymentHash: string): Promise<void> {
    try {
      await this.client.request('cancel_hold_invoice', { payment_hash: paymentHash });
    } catch (e) {
      // Facture inconnue ou déjà expirée : rien à rembourser.
      if (e instanceof NwcError && e.code === 'NOT_FOUND') return;
      throw e;
    }
  }

  async lookupInvoice(paymentHash: string): Promise<{ state: HoldInvoiceState; amountPaidMsat: bigint }> {
    const t = await this.client.request<NwcTransaction>('lookup_invoice', { payment_hash: paymentHash });
    const amount = BigInt(Math.max(0, Math.trunc(Number(t?.amount ?? 0))));
    const s = String(t?.state ?? '').toLowerCase();
    if (t?.settled_at || s === 'settled') return { state: 'SETTLED', amountPaidMsat: amount };
    if (s === 'accepted') return { state: 'ACCEPTED', amountPaidMsat: amount };
    if (s === 'failed' || s === 'expired' || s === 'canceled' || s === 'cancelled') return { state: 'CANCELED', amountPaidMsat: 0n };
    return { state: 'OPEN', amountPaidMsat: 0n };
  }

  async payInvoice(bolt11: string): Promise<void> {
    await this.client.request('pay_invoice', { invoice: bolt11 });
  }

  close(): void {
    this.client.close();
  }
}

// ------------------------------------------------------------------ adresse Lightning (LNURL-pay)

/** Obtient une facture pour une adresse Lightning (ex. moussa@walletofsatoshi.com). */
export async function invoiceForLightningAddress(
  address: string, amountMsat: bigint, comment: string, doFetch: typeof fetch = fetch,
): Promise<string> {
  const m = /^([a-z0-9._-]{1,64})@([a-z0-9.-]{1,253}\.[a-z]{2,})$/.exec(address.toLowerCase());
  if (!m) throw new NwcError('BAD_ADDRESS', 'Adresse Lightning invalide.');
  const [, user, domain] = m;
  if (/^(localhost|.*\.local|.*\.internal)$/.test(domain!) || /^\d+\.\d+\.\d+\.\d+$/.test(domain!)) {
    throw new NwcError('BAD_ADDRESS', 'Domaine d’adresse Lightning refusé.');
  }
  const meta = await (await doFetch(`https://${domain}/.well-known/lnurlp/${user}`, { signal: AbortSignal.timeout(10_000) })).json() as {
    tag?: string; callback?: string; minSendable?: number; maxSendable?: number; commentAllowed?: number;
  };
  if (meta.tag !== 'payRequest' || !meta.callback?.startsWith('https://')) throw new NwcError('BAD_ADDRESS', 'Adresse Lightning injoignable.');
  const amt = Number(amountMsat);
  if ((meta.minSendable && amt < meta.minSendable) || (meta.maxSendable && amt > meta.maxSendable)) {
    throw new NwcError('BAD_AMOUNT', 'Montant refusé par l’adresse Lightning.');
  }
  const url = new URL(meta.callback);
  url.searchParams.set('amount', String(amt));
  if (meta.commentAllowed && comment) url.searchParams.set('comment', comment.slice(0, meta.commentAllowed));
  const res = await (await doFetch(url, { signal: AbortSignal.timeout(10_000) })).json() as { pr?: string };
  if (!res.pr || !/^ln/i.test(res.pr)) throw new NwcError('BAD_ADDRESS', 'Aucune facture reçue de l’adresse Lightning.');
  return res.pr;
}

/**
 * Wallet réel de la vendeuse via Nostr Wallet Connect (NIP-47).
 * Un faux wallet parle le VRAI protocole (événements signés, chiffrement NIP-44 ou NIP-04)
 * sur un relais en mémoire : on vérifie tout le parcours sans réseau.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent, type Event } from 'nostr-tools/pure';
import { matchFilter, type Filter } from 'nostr-tools/filter';
import * as nip04 from 'nostr-tools/nip04';
import * as nip44 from 'nostr-tools/nip44';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { generateSesame, hashPreimage } from '@sesame/core';
import { createServerContext, type ServerContext } from '../src/context.js';
import { buildApp } from '../src/app.js';
import { parseNwcUri, NwcError, NWC_INFO, NWC_REQUEST, NWC_RESPONSE, NWC_NOTIFICATION_NIP04, NWC_NOTIFICATION_NIP44, type NwcTransport } from '../src/wallet/nwc.js';

/** Relais Nostr en mémoire. */
class MemoryRelay implements NwcTransport {
  private readonly events: Event[] = [];
  private readonly subs = new Set<{ filter: Filter; cb: (e: Event) => void }>();
  async publish(_relays: string[], ev: Event): Promise<void> {
    this.events.push(ev);
    for (const s of [...this.subs]) if (matchFilter(s.filter, ev)) s.cb(ev);
  }
  subscribe(_relays: string[], filter: Filter, cb: (e: Event) => void): () => void {
    const s = { filter, cb };
    this.subs.add(s);
    for (const ev of this.events) if (matchFilter(filter, ev)) queueMicrotask(() => this.subs.has(s) && cb(ev));
    return () => this.subs.delete(s);
  }
}

/** Faux wallet NWC (côté Alby Hub) : factures hold en mémoire, réponses chiffrées et signées. */
class FakeNwcWallet {
  readonly sk = generateSecretKey();
  readonly pubkey = getPublicKey(this.sk);
  readonly clientSk = generateSecretKey();
  readonly invoices = new Map<string, { amount: number; state: 'pending' | 'accepted' | 'settled' | 'canceled' }>();
  readonly calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  notify = true;

  constructor(private readonly relay: MemoryRelay, private readonly opts: { encryption: 'nip44_v2' | 'nip04'; methods?: string[] }) {
    const methods = opts.methods ?? ['get_info', 'make_hold_invoice', 'settle_hold_invoice', 'cancel_hold_invoice', 'lookup_invoice', 'pay_invoice'];
    void relay.publish([], finalizeEvent({
      kind: NWC_INFO, created_at: Math.floor(Date.now() / 1000), content: methods.join(' '),
      tags: [['encryption', opts.encryption === 'nip44_v2' ? 'nip44_v2 nip04' : 'nip04'], ['notifications', 'payment_received hold_invoice_accepted']],
    }, this.sk));
    relay.subscribe([], { kinds: [NWC_REQUEST], '#p': [this.pubkey] }, (ev) => void this.handle(ev));
  }

  get uri(): string {
    return `nostr+walletconnect://${this.pubkey}?relay=wss://relay.example.com&secret=${bytesToHex(this.clientSk)}&lud16=fifame@example.com`;
  }

  private enc(text: string, peer: string, nip44mode: boolean) {
    return nip44mode ? nip44.encrypt(text, nip44.getConversationKey(this.sk, peer)) : nip04.encrypt(this.sk, peer, text);
  }

  private async handle(ev: Event) {
    expect(verifyEvent(ev)).toBe(true);
    const n44 = ev.tags.some((t) => t[0] === 'encryption' && t[1] === 'nip44_v2');
    const text = n44 ? nip44.decrypt(ev.content, nip44.getConversationKey(this.sk, ev.pubkey)) : nip04.decrypt(this.sk, ev.pubkey, ev.content);
    const { method, params } = JSON.parse(text) as { method: string; params: Record<string, unknown> };
    this.calls.push({ method, params });
    let result: unknown = {};
    let error: { code: string; message: string } | null = null;
    if (method === 'make_hold_invoice') {
      const hash = String(params.payment_hash);
      this.invoices.set(hash, { amount: Number(params.amount), state: 'pending' });
      result = { type: 'incoming', invoice: `lntbs${params.amount}n1real${hash.slice(0, 16)}`, payment_hash: hash, amount: params.amount };
    } else if (method === 'settle_hold_invoice') {
      const inv = this.invoices.get(hashPreimage(String(params.preimage)));
      if (inv?.state === 'accepted') inv.state = 'settled'; else error = { code: 'NOT_FOUND', message: 'not accepted' };
    } else if (method === 'cancel_hold_invoice') {
      const inv = this.invoices.get(String(params.payment_hash));
      if (inv) inv.state = 'canceled'; else error = { code: 'NOT_FOUND', message: 'unknown' };
    } else if (method === 'lookup_invoice') {
      const inv = this.invoices.get(String(params.payment_hash));
      result = inv ? { amount: inv.state === 'pending' ? 0 : inv.amount, state: inv.state } : {};
    } else if (method === 'pay_invoice') {
      result = { preimage: '00'.repeat(32) };
    }
    await this.relay.publish([], finalizeEvent({
      kind: NWC_RESPONSE, created_at: Math.floor(Date.now() / 1000),
      tags: [['p', ev.pubkey], ['e', ev.id]],
      content: this.enc(JSON.stringify({ result_type: method, error, result: error ? null : result }), ev.pubkey, n44),
    }, this.sk));
  }

  /** Le client paie la facture depuis son propre wallet : le HTLC arrive et reste bloqué. */
  async payerPays(hash: string) {
    const inv = this.invoices.get(hash)!;
    inv.state = 'accepted';
    if (!this.notify) return;
    const n44 = this.opts.encryption === 'nip44_v2';
    await this.relay.publish([], finalizeEvent({
      kind: n44 ? NWC_NOTIFICATION_NIP44 : NWC_NOTIFICATION_NIP04, created_at: Math.floor(Date.now() / 1000),
      tags: [['p', getPublicKey(this.clientSk)]],
      content: this.enc(JSON.stringify({ notification_type: 'hold_invoice_accepted', notification: { payment_hash: hash, amount: inv.amount, state: 'accepted' } }), getPublicKey(this.clientSk), n44),
    }, this.sk));
  }
}

const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const until = async (cond: () => Promise<boolean> | boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!(await cond())) { if (Date.now() > end) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 20)); }
};

// Adresse Lightning du livreur (LNURL-pay) simulée
const lnurlFetch = (async (url: string | URL) => {
  const u = String(url);
  if (u.includes('/.well-known/lnurlp/moussa')) return new Response(JSON.stringify({ tag: 'payRequest', callback: 'https://wos.example.com/cb', minSendable: 1000, maxSendable: 1e11, commentAllowed: 80 }));
  if (u.startsWith('https://wos.example.com/cb')) return new Response(JSON.stringify({ pr: 'lntbs15000n1courier' }));
  return new Response('{}', { status: 404 });
}) as typeof fetch;

let relay: MemoryRelay;
let ctx: ServerContext;
let app: FastifyInstance;

beforeEach(async () => {
  relay = new MemoryRelay();
  ctx = createServerContext({ mode: 'simulation', fixedXofPerBtc: 60_000_000, nwcTransport: relay, nwcTimeoutMs: 2000, fetch: lnurlFetch });
  app = buildApp(ctx);
  await app.ready();
});
afterEach(async () => {
  await app.close();
});

async function shopWithWallet(wallet: FakeNwcWallet) {
  const s = (await app.inject({ method: 'POST', url: '/api/shops', payload: { name: 'Pagnes de Fifamè', city: 'Cotonou', pin: '4821' } })).json() as { shopId: string; sellerToken: string };
  const r = await app.inject({ method: 'POST', url: '/api/shops/me/wallet', headers: auth(s.sellerToken), payload: { uri: wallet.uri } });
  return { ...s, connect: r };
}

describe('Code de connexion NWC', () => {
  it('lit un code valide et refuse un code invalide', () => {
    const sk = bytesToHex(generateSecretKey());
    const pk = getPublicKey(hexToBytes(sk));
    const c = parseNwcUri(`nostr+walletconnect://${pk}?relay=wss://relay.getalby.com/v1&secret=${sk}&lud16=a@b.com`);
    expect(c).toMatchObject({ walletPubkey: pk, relays: ['wss://relay.getalby.com/v1'], secret: sk, lud16: 'a@b.com' });
    expect(() => parseNwcUri('https://example.com')).toThrow(NwcError);
    expect(() => parseNwcUri(`nostr+walletconnect://${pk}?relay=ws://insecure&secret=${sk}`)).toThrow(/wss/);
    expect(() => parseNwcUri(`nostr+walletconnect://${pk}?relay=wss://r.example`)).toThrow(/secret/);
  });
});

describe('Wallet réel de la vendeuse (NWC)', () => {
  for (const encryption of ['nip44_v2', 'nip04'] as const) {
    it(`parcours complet avec de vraies factures hold (${encryption})`, async () => {
      const wallet = new FakeNwcWallet(relay, { encryption });
      const s = await shopWithWallet(wallet);
      expect(s.connect.statusCode).toBe(200);
      expect(s.connect.json()).toMatchObject({ connected: true, holdInvoices: true, encryption });
      expect(s.connect.body).not.toContain(bytesToHex(wallet.clientSk)); // le secret n'est jamais renvoyé

      // Le code est chiffré en base.
      const raw = ctx.db.prepare('SELECT wallet FROM shops WHERE id = ?').get(s.shopId) as { wallet: string };
      expect(raw.wallet).not.toContain('walletconnect');

      const created = (await app.inject({
        method: 'POST', url: '/api/orders', headers: auth(s.sellerToken),
        payload: { itemLabel: '2 pagnes wax', itemXof: 18_000, deliveryFeeXof: 1_500, deliveryHours: 6 },
      })).json() as { order: { id: string; simulation: boolean; realWallet: boolean }; clientToken: string };
      expect(created.order).toMatchObject({ simulation: false, realWallet: true });
      const id = created.order.id;

      // Le client : H seulement ; la facture vient du wallet de la vendeuse.
      const sesame = generateSesame();
      const lock = await app.inject({ method: 'POST', url: `/api/orders/${id}/lock`, headers: auth(created.clientToken), payload: { paymentHash: sesame.paymentHash } });
      expect(lock.statusCode).toBe(200);
      expect((lock.json() as { bolt11: string }).bolt11).toMatch(/^lntbs/);
      expect(wallet.calls.find((c) => c.method === 'make_hold_invoice')?.params).toMatchObject({ payment_hash: sesame.paymentHash, amount: 32_500_000 });

      // Le paiement simulé est refusé pour une commande réelle.
      expect((await app.inject({ method: 'POST', url: `/api/demo/pay/${id}`, headers: auth(created.clientToken), payload: {} })).statusCode).toBe(409);

      // Le client paie depuis son propre wallet : notification « hold_invoice_accepted ».
      await wallet.payerPays(sesame.paymentHash);
      await until(async () => (await ctx.store.get(id))?.state === 'FUNDS_LOCKED');

      // Livreur, puis libération avec le sésame : la facture est réglée dans le wallet de la vendeuse.
      await app.inject({ method: 'POST', url: `/api/orders/${id}/assign`, headers: auth(s.sellerToken), payload: { lightningAddress: 'moussa@wos.example.com' } });
      const rel = await app.inject({ method: 'POST', url: `/api/orders/${id}/release`, headers: auth(created.clientToken), payload: { preimage: sesame.preimage } });
      expect(rel.statusCode).toBe(200);
      expect(wallet.invoices.get(sesame.paymentHash)?.state).toBe('settled');
      const order = await ctx.store.get(id);
      expect(order!.state).toBe('RELEASED');
      // Le livreur est payé depuis le wallet de la vendeuse (adresse Lightning → facture → pay_invoice).
      expect(wallet.calls.some((c) => c.method === 'pay_invoice' && c.params.invoice === 'lntbs15000n1courier')).toBe(true);
      expect(order!.payouts.find((p) => p.kind === 'courier')?.status).toBe('sent');
      expect(order!.payouts.some((p) => p.kind === 'seller')).toBe(false); // les sats sont déjà chez elle
    });
  }

  it('sans livraison : la facture est annulée dans le wallet (remboursement)', async () => {
    const wallet = new FakeNwcWallet(relay, { encryption: 'nip44_v2' });
    const s = await shopWithWallet(wallet);
    const c = (await app.inject({ method: 'POST', url: '/api/orders', headers: auth(s.sellerToken), payload: { itemLabel: 'Sac', itemXof: 5_000, deliveryFeeXof: 0, deliveryHours: 2 } })).json() as { order: { id: string }; clientToken: string };
    const sesame = generateSesame();
    await app.inject({ method: 'POST', url: `/api/orders/${c.order.id}/lock`, headers: auth(c.clientToken), payload: { paymentHash: sesame.paymentHash } });
    await wallet.payerPays(sesame.paymentHash);
    await until(async () => (await ctx.store.get(c.order.id))?.state === 'FUNDS_LOCKED');
    await app.inject({ method: 'POST', url: `/api/orders/${c.order.id}/cancel`, headers: auth(s.sellerToken), payload: {} });
    expect(wallet.invoices.get(sesame.paymentHash)?.state).toBe('canceled');
    expect((await ctx.store.get(c.order.id))!.state).toBe('REFUNDED');
  });

  it('notification perdue : le paiement est détecté en interrogeant le wallet', async () => {
    const wallet = new FakeNwcWallet(relay, { encryption: 'nip44_v2' });
    wallet.notify = false;
    const s = await shopWithWallet(wallet);
    const c = (await app.inject({ method: 'POST', url: '/api/orders', headers: auth(s.sellerToken), payload: { itemLabel: 'Sac', itemXof: 5_000, deliveryFeeXof: 0, deliveryHours: 6 } })).json() as { order: { id: string }; clientToken: string };
    const sesame = generateSesame();
    await app.inject({ method: 'POST', url: `/api/orders/${c.order.id}/lock`, headers: auth(c.clientToken), payload: { paymentHash: sesame.paymentHash } });
    await wallet.payerPays(sesame.paymentHash);
    expect((await ctx.store.get(c.order.id))!.state).toBe('AWAITING_PAYMENT');
    await ctx.wallets.pollPending(ctx.store);
    expect((await ctx.store.get(c.order.id))!.state).toBe('FUNDS_LOCKED');
  });

  it('refuse un wallet qui ne gère pas les factures hold', async () => {
    const wallet = new FakeNwcWallet(relay, { encryption: 'nip44_v2', methods: ['get_info', 'pay_invoice', 'make_invoice'] });
    const s = await shopWithWallet(wallet);
    expect(s.connect.statusCode).toBe(400);
    expect(s.connect.json()).toMatchObject({ error: 'HOLD_UNSUPPORTED' });
    expect(ctx.wallets.isConnected(s.shopId)).toBe(false);
  });

  it('refuse de débrancher le wallet tant qu\'une commande payée attend sa livraison', async () => {
    const wallet = new FakeNwcWallet(relay, { encryption: 'nip44_v2' });
    const s = await shopWithWallet(wallet);
    const c = (await app.inject({ method: 'POST', url: '/api/orders', headers: auth(s.sellerToken), payload: { itemLabel: 'Sac', itemXof: 5_000, deliveryFeeXof: 0, deliveryHours: 6 } })).json() as { order: { id: string }; clientToken: string };
    const sesame = generateSesame();
    await app.inject({ method: 'POST', url: `/api/orders/${c.order.id}/lock`, headers: auth(c.clientToken), payload: { paymentHash: sesame.paymentHash } });
    const r = await app.inject({ method: 'POST', url: '/api/shops/me/wallet/disconnect', headers: auth(s.sellerToken), payload: {} });
    expect(r.statusCode).toBe(409);
  });

  it('un wallet injoignable donne un message clair (502), sans planter', async () => {
    const sk = bytesToHex(generateSecretKey());
    const ghost = `nostr+walletconnect://${getPublicKey(generateSecretKey())}?relay=wss://relay.example.com&secret=${sk}`;
    const s = (await app.inject({ method: 'POST', url: '/api/shops', payload: { name: 'Boutique', city: 'Dakar', pin: '4821' } })).json() as { sellerToken: string };
    const r = await app.inject({ method: 'POST', url: '/api/shops/me/wallet', headers: auth(s.sellerToken), payload: { uri: ghost } });
    expect(r.statusCode).toBe(502);
    expect(r.json()).toMatchObject({ error: 'WALLET_UNREACHABLE' });
  }, 15_000);
});

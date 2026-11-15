/**
 * Parcours complet RÉEL à travers l'application (serveur Sésame en marche) :
 * la vendeuse branche un wallet de test (faucet NWC d'Alby), le client paie depuis son propre wallet,
 * le livreur libère avec le sésame. Usage : npx tsx scripts/nwc-live-e2e.ts http://127.0.0.1:8080
 */
import { generateSesame } from '@sesame/core';
import { NwcClient, parseNwcUri, PoolTransport } from '../apps/server/src/wallet/nwc.js';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8080';
const step = (s: string) => console.log(`\n▶ ${s}`);

async function api<T>(path: string, body?: unknown, token?: string): Promise<T> {
  const res = await fetch(BASE + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? null : JSON.stringify(body),
  });
  const data = (await res.json()) as T & { message?: string };
  if (!res.ok && res.status !== 202) throw new Error(`${path} → ${res.status} ${data.message ?? ''}`);
  return data;
}
const faucet = async (balance: number) => (await (await fetch(`https://faucet.nwc.dev?balance=${balance}`, { method: 'POST' })).text()).trim();

async function main() {
  step('Création de la boutique et de deux wallets de test');
  const shop = await api<{ sellerToken: string; slug: string }>('/api/shops', { name: 'Boutique test réel', city: 'Dakar', pin: '4821' });
  const sellerUri = await faucet(0);
  const buyer = new NwcClient(parseNwcUri(await faucet(5_000)), new PoolTransport(), 90_000);

  step('La vendeuse branche son wallet (« Mon wallet Lightning »)');
  console.log(' ', await api('/api/shops/me/wallet', { uri: sellerUri }, shop.sellerToken));

  step('Commande de 1 000 FCFA');
  const c = await api<{ order: { id: string; realWallet: boolean; simulation: boolean; amountSat: string }; clientToken: string }>(
    '/api/orders', { itemLabel: 'Essai réel', itemXof: 1_000, deliveryFeeXof: 0, deliveryHours: 2 }, shop.sellerToken);
  console.log(`  commande réelle : ${c.order.realWallet} · ${c.order.amountSat} sats`);

  const s = generateSesame();
  const lock = await api<{ bolt11: string }>(`/api/orders/${c.order.id}/lock`, { paymentHash: s.paymentHash }, c.clientToken);
  step(`Facture hold émise par le wallet de la vendeuse : ${lock.bolt11.slice(0, 30)}…`);

  step('Le client paie depuis son propre wallet');
  const paid = buyer.request('pay_invoice', { invoice: lock.bolt11 }).then(() => 'réglé', (e: Error) => e.message);
  let state = '';
  for (let i = 0; i < 60 && state !== 'FUNDS_LOCKED'; i++) {
    await new Promise((r) => setTimeout(r, 1_000));
    state = (await api<{ state: string }>(`/api/orders/${c.order.id}`, undefined, c.clientToken)).state;
  }
  console.log('  état de la commande :', state);
  if (state !== 'FUNDS_LOCKED') throw new Error('paiement non détecté');

  step('Livraison : le client présente son sésame');
  const rel = await api<{ state: string }>(`/api/orders/${c.order.id}/release`, { preimage: s.preimage }, c.clientToken);
  console.log('  état :', rel.state, '· paiement client :', await paid);
  const seller = new NwcClient(parseNwcUri(sellerUri), new PoolTransport(), 30_000);
  console.log('  solde du wallet de la vendeuse :', (await seller.request<{ balance: number }>('get_balance', {})).balance / 1000, 'sats');
  console.log(`\n✔ Réputation : ${BASE}/verify/${shop.slug}`);
  process.exit(0);
}
main().catch((e) => { console.error('\n✘', e instanceof Error ? e.message : e); process.exit(1); });

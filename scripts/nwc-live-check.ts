/**
 * Essai RÉEL d'une facture hold via Nostr Wallet Connect, avec deux wallets de test
 * créés par le faucet NWC d'Alby (https://faucet.nwc.dev, sats de test gratuits).
 *
 *   npx tsx scripts/nwc-live-check.ts            → bloque puis RÈGLE (livraison)
 *   npx tsx scripts/nwc-live-check.ts --cancel   → bloque puis ANNULE (remboursement)
 *
 * Vendeuse : wallet A (crée la facture hold à partir de H, la règle avec P).
 * Client   : wallet B (paie la facture depuis SON wallet).
 */
import { generateSesame } from '@sesame/core';
import { NwcClient, NwcHoldWallet, parseNwcUri, PoolTransport } from '../apps/server/src/wallet/nwc.js';

const cancel = process.argv.includes('--cancel');
const step = (s: string) => console.log(`\n▶ ${s}`);

async function faucetWallet(balance: number): Promise<string> {
  const res = await fetch(`https://faucet.nwc.dev?balance=${balance}`, { method: 'POST' });
  if (!res.ok) throw new Error(`faucet ${res.status}`);
  return (await res.text()).trim();
}

async function main() {
  const transport = new PoolTransport();
  step('Création de deux wallets de test (faucet NWC d’Alby)');
  const sellerUri = await faucetWallet(0);
  const buyerUri = await faucetWallet(10_000);
  console.log('  vendeuse :', parseNwcUri(sellerUri).lud16, '| client :', parseNwcUri(buyerUri).lud16);

  const seller = new NwcHoldWallet(new NwcClient(parseNwcUri(sellerUri), transport, 30_000));
  const buyer = new NwcClient(parseNwcUri(buyerUri), transport, 60_000);

  step('Le wallet de la vendeuse gère-t-il les factures hold ?');
  const info = await seller.check();
  console.log('  oui · chiffrement', info.encryption, '· notifications :', info.notifications.join(', ') || '(aucune)');

  const accepted = new Promise<bigint>((resolve) => seller.onAccepted((_h, amount) => resolve(amount)));
  const s = generateSesame();
  step(`Le téléphone du client génère le sésame ; seule l’empreinte H part : ${s.paymentHash.slice(0, 16)}…`);

  step('La vendeuse crée une facture hold de 1 000 sats liée à H (dans SON wallet)');
  const { bolt11 } = await seller.makeHoldInvoice({ paymentHash: s.paymentHash, amountMsat: 1_000_000n, description: 'Sésame · essai réel', expirySec: 600, cltvExpiryBlocks: 144 });
  console.log('  facture :', bolt11.slice(0, 40) + '…');

  const before = await buyer.request<{ balance: number }>('get_balance', {});
  step(`Le client paie depuis son propre wallet (solde avant : ${before.balance / 1000} sats)`);
  const payment = buyer.request('pay_invoice', { invoice: bolt11 }).then(
    () => 'payé', (e: Error) => `refusé/annulé (${e.message})`,
  );

  const got = await Promise.race([accepted, new Promise<null>((r) => setTimeout(() => r(null), 45_000))]);
  let state = (await seller.lookupInvoice(s.paymentHash)).state;
  console.log(`  notification hold_invoice_accepted : ${got !== null ? `reçue (${Number(got) / 1000} sats)` : 'non reçue'} · état : ${state}`);
  if (state !== 'ACCEPTED') throw new Error('Le paiement n’est pas bloqué : état ' + state);

  const during = await buyer.request<{ balance: number }>('get_balance', {});
  console.log(`  argent BLOQUÉ : solde du client ${during.balance / 1000} sats ; la vendeuse ne peut pas encore l’encaisser`);

  if (cancel) {
    step('Pas de livraison : la facture est annulée (remboursement)');
    await seller.cancelHoldInvoice(s.paymentHash);
  } else {
    step('Livraison : le sésame P est présenté, la facture est réglée');
    await seller.settleHoldInvoice(s.preimage);
  }
  console.log('  paiement côté client :', await payment);
  await new Promise((r) => setTimeout(r, 2_000));
  state = (await seller.lookupInvoice(s.paymentHash)).state;
  const after = await buyer.request<{ balance: number }>('get_balance', {});
  const sellerBal = await seller.client.request<{ balance: number }>('get_balance', {});
  console.log(`\n✔ état final : ${state} · solde client ${after.balance / 1000} sats · solde vendeuse ${sellerBal.balance / 1000} sats`);
  seller.close();
  process.exit(0);
}

main().catch((e) => { console.error('\n✘', e instanceof Error ? `${(e as { code?: string }).code ?? ''} ${e.message}` : e); process.exit(1); });

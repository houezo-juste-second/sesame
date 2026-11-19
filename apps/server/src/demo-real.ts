/**
 * Démo « vrais wallets Lightning » : trois wallets de test créés à la volée sur le faucet NWC d'Alby
 * (vendeuse, cliente, livreur). Les paiements sont de vrais paiements Lightning (factures hold réelles),
 * avec des sats de test sans valeur. Les liens des wallets restent en mémoire, jamais envoyés au navigateur.
 */
import { NwcClient, parseNwcUri, PoolTransport } from './wallet/nwc.js';

export const FAUCET_URL = 'https://faucet.nwc.dev';
const TTL_MS = 2 * 60 * 60 * 1000;

export interface DemoWallets {
  seller: string;
  buyer: string;
  courier: string;
  courierAddress: string | null;
  expiresAt: number;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Crée un wallet de test (jusqu'à 4 essais espacés : le faucet limite les rafales). */
export async function faucetWallet(balanceSats: number, fetchImpl: FetchLike = fetch, pauseMs = 1_500): Promise<string> {
  let last: unknown;
  for (let i = 0; i < 4; i++) {
    if (i) await new Promise((r) => setTimeout(r, pauseMs * i));
    try {
      return await faucetOnce(balanceSats, fetchImpl);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

async function faucetOnce(balanceSats: number, fetchImpl: FetchLike): Promise<string> {
  const res = await fetchImpl(`${FAUCET_URL}?balance=${balanceSats}`, { method: 'POST', signal: AbortSignal.timeout(20_000) });
  const uri = (await res.text()).trim();
  if (!res.ok || !uri.startsWith('nostr+walletconnect://')) throw new Error(`FAUCET_${res.status}`);
  parseNwcUri(uri); // vérifie le format
  return uri;
}

export class DemoWalletStore {
  private readonly byOrder = new Map<string, DemoWallets>();

  async create(fetchImpl: FetchLike = fetch): Promise<DemoWallets> {
    // Une création après l'autre : le faucet refuse les rafales.
    const seller = await faucetWallet(0, fetchImpl);
    const buyer = await faucetWallet(20_000, fetchImpl);
    const courier = await faucetWallet(0, fetchImpl);
    return { seller, buyer, courier, courierAddress: parseNwcUri(courier).lud16 ?? null, expiresAt: Date.now() + TTL_MS };
  }

  set(orderId: string, w: DemoWallets): void {
    this.prune();
    this.byOrder.set(orderId, w);
  }

  get(orderId: string): DemoWallets | undefined {
    this.prune();
    return this.byOrder.get(orderId);
  }

  private prune(): void {
    const now = Date.now();
    for (const [k, v] of this.byOrder) if (v.expiresAt < now) this.byOrder.delete(k);
  }
}

/** La cliente paie la facture depuis son wallet de test. La facture hold reste « en vol » jusqu'à la livraison. */
export function payFromBuyer(w: DemoWallets, bolt11: string, onError: (e: unknown) => void): void {
  const client = new NwcClient(parseNwcUri(w.buyer), new PoolTransport(), 3 * 60 * 60 * 1000);
  client.request('pay_invoice', { invoice: bolt11 }).catch(onError).finally(() => client.close());
}

/** Soldes des trois wallets de test, en sats (null si un wallet ne répond pas). */
export async function demoBalances(w: DemoWallets): Promise<Record<'seller' | 'buyer' | 'courier', number | null>> {
  const one = async (uri: string) => {
    const client = new NwcClient(parseNwcUri(uri), new PoolTransport(), 15_000);
    try {
      const r = await client.request<{ balance: number }>('get_balance', {});
      return Math.floor(r.balance / 1000);
    } catch {
      return null;
    } finally {
      client.close();
    }
  };
  const [seller, buyer, courier] = await Promise.all([one(w.seller), one(w.buyer), one(w.courier)]);
  return { seller, buyer, courier };
}

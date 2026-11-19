/** Vérifie la démo « vrais wallets » de bout en bout : npx tsx scripts/demo-real-e2e.ts http://127.0.0.1:8080 */
import { generateSesame } from '@sesame/core';
const BASE = process.argv[2] ?? 'http://127.0.0.1:8080';
async function api<T>(path: string, body?: unknown, token?: string): Promise<T> {
  const res = await fetch(BASE + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? null : JSON.stringify(body) });
  const d = (await res.json()) as T & { message?: string };
  if (!res.ok) throw new Error(`${path} → ${res.status} ${d.message ?? ''}`);
  return d;
}
const t0 = Date.now(); const log = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);
const d = await api<{ orderId: string; sellerToken: string; clientToken: string; courierAddress: string | null }>('/api/demo/start', { real: true });
log(`démo créée, adresse livreur : ${d.courierAddress}`);
const s = generateSesame();
const lock = await api<{ bolt11: string }>(`/api/orders/${d.orderId}/lock`, { paymentHash: s.paymentHash }, d.clientToken);
log(`facture hold : ${lock.bolt11.slice(0, 24)}…`);
await api(`/api/demo/pay/${d.orderId}`, {}, d.clientToken);
let st = '';
for (let i = 0; i < 60 && st !== 'FUNDS_LOCKED'; i++) { await new Promise((r) => setTimeout(r, 1000)); st = (await api<{ state: string }>(`/api/orders/${d.orderId}`, undefined, d.clientToken)).state; }
log(`état : ${st}`); if (st !== 'FUNDS_LOCKED') process.exit(1);
if (d.courierAddress) { await api(`/api/orders/${d.orderId}/assign`, { lightningAddress: d.courierAddress }, d.sellerToken); log('livreur assigné'); }
const rel = await api<{ state: string }>(`/api/orders/${d.orderId}/release`, { preimage: s.preimage }, d.clientToken);
log(`libération : ${rel.state}`);
for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 4000)); log(`soldes : ${JSON.stringify(await api(`/api/demo/balances/${d.orderId}`, undefined, d.sellerToken))}`); }
process.exit(0);

/**
 * Page publique de réputation (/verify/:slug).
 * Les reçus sont vérifiés ICI, dans le navigateur : signature de la boutique + preuve de paiement
 * (SHA-256(preimage) = payment_hash). Le serveur ne peut pas inventer de livraisons.
 * Si des relais Nostr sont configurés, les reçus y sont aussi relus directement.
 */
import { useEffect, useState } from 'preact/hooks';
import { checkReceipt, RECEIPT_KIND, type ReceiptCheck } from '@sesame/core';
import type { Event } from 'nostr-tools/pure';
import { api, ApiError, initials, xof } from '../api.js';
import { Check, Shield } from '../ui/icons.js';
import { copyText, ErrorBox, Loading, Toast, TopBar, useToast } from '../ui/kit.js';

interface ReceiptsResponse {
  shopName: string; city: string; since: string; pubkey: string; npub: string; relays: string[]; events: Event[];
}

interface Row { ev: Event; check: ReceiptCheck; amount: number; at: Date }

async function fromRelays(relays: string[], pubkey: string): Promise<Event[]> {
  if (relays.length === 0) return [];
  try {
    const { SimplePool } = await import('nostr-tools/pool');
    const pool = new SimplePool();
    const events = await pool.querySync(relays, { kinds: [RECEIPT_KIND], authors: [pubkey], '#t': ['sesame'], limit: 200 }, { maxWait: 4_000 });
    pool.close(relays);
    return events;
  } catch {
    return [];
  }
}

export function Verify({ slug }: { slug: string }) {
  const [data, setData] = useState<ReceiptsResponse | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [fromRelayCount, setFromRelayCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [toast, showToast] = useToast();

  useEffect(() => {
    (async () => {
      try {
        const r = await api<ReceiptsResponse>(`/api/shops/${encodeURIComponent(slug)}/receipts`);
        setData(r);
        const relayEvents = await fromRelays(r.relays, r.pubkey);
        setFromRelayCount(relayEvents.length);
        const byId = new Map<string, Event>();
        for (const ev of [...r.events, ...relayEvents]) byId.set(ev.id, ev);
        setRows(
          [...byId.values()]
            .map((ev) => {
              const check = checkReceipt(ev);
              // Un reçu signé par une autre clé que celle de la boutique ne compte pas.
              const valid = check.valid && ev.pubkey === r.pubkey;
              const amount = Number(ev.tags.find((t) => t[0] === 'amount_xof')?.[1] ?? 0);
              return { ev, check: { ...check, valid }, amount, at: new Date(ev.created_at * 1000) };
            })
            .sort((a, b) => b.at.getTime() - a.at.getTime()),
        );
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Erreur de chargement.');
      }
    })();
  }, [slug]);

  if (!data) return <div class="screen"><TopBar />{error ? <div class="content"><ErrorBox message={error} /></div> : <Loading />}</div>;

  const released = rows.filter((r) => r.check.valid && r.check.outcome === 'released').length;
  const refunded = rows.filter((r) => r.check.valid && r.check.outcome === 'refunded').length;
  const invalid = rows.filter((r) => !r.check.valid).length;

  return (
    <div class="screen">
      <TopBar />
      <main class="content fade-in">
        <section class="row">
          <div class="avatar" aria-hidden="true">{initials(data.shopName)}</div>
          <div class="grow">
            <h2>{data.shopName}</h2>
            <div class="small muted">{data.city} · sur Sésame depuis {new Date(data.since).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</div>
          </div>
        </section>

        <section class="card deep stack" style="gap:14px">
          <div class="row" style="gap:8px"><Shield /><strong>Réputation vérifiée dans votre navigateur</strong></div>
          <div class="stats">
            <div class="stat" style="background:rgba(255,255,255,0.09);border:0"><b style="color:#8FE3AE">{released}</b><span class="tiny" style="color:#C9C7F2">livraisons prouvées</span></div>
            <div class="stat" style="background:rgba(255,255,255,0.09);border:0"><b>{refunded}</b><span class="tiny" style="color:#C9C7F2">remboursements</span></div>
            {invalid > 0 && <div class="stat" style="background:rgba(255,255,255,0.09);border:0"><b style="color:#F5C766">{invalid}</b><span class="tiny" style="color:#C9C7F2">reçus rejetés</span></div>}
          </div>
        </section>

        <section class="card small stack" style="gap:6px;line-height:1.5">
          <span>Chaque reçu est <strong>signé par la boutique</strong> et, pour une livraison, contient la <strong>preuve de paiement Lightning</strong>. Ce contrôle est fait ici, sur votre téléphone : le serveur Sésame ne peut pas inventer de livraisons.</span>
          <button class="btn ghost" style="height:40px;font-size:12px" onClick={async () => showToast((await copyText(data.npub)) ? 'Clé publique copiée' : 'Copie impossible')}>
            <span class="mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{data.npub}</span>
          </button>
          <span class="tiny muted">
            Source : serveur Sésame{data.relays.length > 0 ? ` + ${fromRelayCount} reçu(s) relu(s) sur ${data.relays.length} relais Nostr` : ' (publication sur relais Nostr désactivée en démo)'}.
          </span>
        </section>

        <h2 style="font-size:16px">Reçus</h2>
        {rows.length === 0 && <div class="card small muted">Aucun reçu pour l'instant.</div>}
        <div class="stack" style="gap:8px">
          {rows.map(({ ev, check, amount, at }) => (
            <div key={ev.id} class="card row" style="padding:12px 14px">
              <div class="grow">
                <div style="font-weight:600;font-size:14px">{xof(amount)}</div>
                <div class="tiny muted">{at.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} vers {at.getHours()}h</div>
              </div>
              <div style="text-align:right">
                {check.valid ? (
                  <span class={`pill ${check.outcome === 'released' ? 'RELEASED' : 'REFUNDED'}`}>
                    {check.outcome === 'released' ? <><Check size={11} color="currentColor" /> Livrée · paiement prouvé</> : 'Remboursée'}
                  </span>
                ) : (
                  <span class="pill EXPIRED">Reçu invalide</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </main>
      <Toast text={toast} />
    </div>
  );
}

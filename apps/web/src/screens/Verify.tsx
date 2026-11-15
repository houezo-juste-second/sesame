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
import { errorText, locale, t } from '../i18n.js';

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
        setError(errorText(e, 'Erreur de chargement.'));
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
            <div class="small muted">{t('{city}, sur Sésame depuis {since}', { city: data.city, since: new Date(data.since).toLocaleDateString(locale(), { month: 'long', year: 'numeric' }) })}</div>
          </div>
        </section>

        <section class="band">
          <div class="row" style="gap:8px"><Shield /><strong>{t('Vérifié sur votre téléphone')}</strong></div>
          <div class="figures" style={invalid > 0 ? '' : 'grid-template-columns:repeat(2, minmax(0, 1fr))'}>
            <div><b style="color:#8FE3AE">{released}</b><span>{t('livraisons prouvées')}</span></div>
            <div><b>{refunded}</b><span>{t('remboursements')}</span></div>
            {invalid > 0 && <div><b style="color:var(--saffron)">{invalid}</b><span>{t('reçus rejetés')}</span></div>}
          </div>
        </section>

        <section class="card small stack" style="gap:6px;line-height:1.5">
          <span>{t('Chaque reçu est')} <strong>{t('signé par la boutique')}</strong> {t('et, pour une livraison, contient la')} <strong>{t('preuve de paiement Lightning')}</strong>. {t('Ce contrôle est fait ici, sur votre téléphone : le serveur Sésame ne peut pas inventer de livraisons.')}</span>
          <button class="btn ghost" style="height:40px;font-size:12px" onClick={async () => showToast((await copyText(data.npub)) ? t('Clé publique copiée') : t('Copie impossible'))}>
            <span class="mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{data.npub}</span>
          </button>
          <span class="tiny muted">
            {t('Source : serveur Sésame')}{data.relays.length > 0 ? t(' + {n} reçu(s) relu(s) sur {r} relais Nostr', { n: fromRelayCount, r: data.relays.length }) : t(' (publication sur relais Nostr désactivée en démo)')}.
          </span>
        </section>

        <h2 class="section-title">{t('Reçus')}</h2>
        <div class="list">
          {rows.length === 0 && <div class="list-empty">{t("Aucun reçu pour l'instant.")}</div>}
          {rows.map(({ ev, check, amount, at }) => (
            <div key={ev.id} class="list-row">
              <div class="grow">
                <div class="amount">{xof(amount)}</div>
                <div class="tiny muted">{t('{date} vers {h}h', { date: at.toLocaleDateString(locale(), { day: 'numeric', month: 'short' }), h: at.getHours() })}</div>
              </div>
              <div style="text-align:right">
                {check.valid ? (
                  <span class={`pill ${check.outcome === 'released' ? 'RELEASED' : 'REFUNDED'}`}>
                    {check.outcome === 'released' ? <><Check size={11} color="currentColor" /> {t('Livrée, paiement prouvé')}</> : t('Remboursée')}
                  </span>
                ) : (
                  <span class="pill EXPIRED">{t('Reçu invalide')}</span>
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

/**
 * « Essayer la démo » : les trois rôles sur un seul téléphone.
 * Le serveur crée une boutique de démonstration jetable ; ce module garde ses jetons localement
 * et affiche une barre de guidage qui dit quoi faire à chaque étape.
 */
import { useEffect, useState } from 'preact/hooks';
import { api, ApiError, local, SELLER_KEY, subscribe, type OrderView } from './api.js';
import { navigate } from './router.js';
import { ErrorBox, LangToggle } from './ui/kit.js';
import { errorText, t } from './i18n.js';

const DEMO_KEY = 'sesame:demo';
const BEFORE_KEY = 'sesame:seller:before-demo';
const COURIER_ADDRESS = 'moussa@livreur.demo';

export interface DemoState { orderId: string; slug: string; sellerToken: string; clientToken: string; courierToken?: string; real?: boolean; courierAddress?: string | null }

/** Commande de la démo « vrais wallets Lightning » (sats de test) ? */
export function isRealDemo(orderId: string): boolean {
  const d = getDemo();
  return Boolean(d?.real && d.orderId === orderId);
}

export function getDemo(): DemoState | null {
  try {
    const raw = local.get(DEMO_KEY);
    return raw ? (JSON.parse(raw) as DemoState) : null;
  } catch {
    return null;
  }
}

function saveDemo(d: DemoState): void {
  local.set(DEMO_KEY, JSON.stringify(d));
}

export function quitDemo(): void {
  const before = local.get(BEFORE_KEY);
  if (before) local.set(SELLER_KEY, before); else local.remove(SELLER_KEY);
  local.remove(BEFORE_KEY);
  local.remove(DEMO_KEY);
  document.body.classList.remove('demo-on');
  navigate('/');
}

async function startDemo(real: boolean): Promise<DemoState> {
  const d = await api<DemoState>('/api/demo/start', { body: real ? { real: true } : {} });
  // Mémorise la session vendeuse éventuelle pour la rendre en quittant la démo.
  const current = local.get(SELLER_KEY);
  if (current && !getDemo()) local.set(BEFORE_KEY, current);
  local.set(SELLER_KEY, d.sellerToken);
  local.set(`sesame:ctok:${d.orderId}`, d.clientToken);
  local.set(`sesame:tok:c:${d.orderId}`, d.clientToken);
  saveDemo(d);
  return d;
}

/** Écran /demo : prépare la démo puis ouvre la commande côté vendeuse. */
export function DemoStart({ real = false }: { real?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    startDemo(real)
      .then((d) => navigate(`/v/o/${d.orderId}`))
      .catch((e) => setError(errorText(e, 'Impossible de lancer la démo.')));
  }, []);
  return (
    <div class="screen">
      <main class="content" style="justify-content:safe center;align-items:center;text-align:center;gap:14px">
        {error ? (
          <>
            <ErrorBox message={error} />
            <button class="btn ghost" onClick={() => navigate('/')}>{t("Retour à l'accueil")}</button>
          </>
        ) : (
          <>
            <h1>{t('Préparation de la démo')}</h1>
            <p class="muted">{real
              ? t('Trois vrais wallets Lightning de test sont créés pour vous (vendeuse, cliente, livreur). Cela prend une dizaine de secondes.')
              : t('Une boutique de démonstration et une commande sont créées pour vous.')}</p>
          </>
        )}
      </main>
    </div>
  );
}

type Role = 'seller' | 'client' | 'courier';

const guide = (real = false): Record<string, { step: string; text: string; next: Role | null }> => ({
  DRAFT: { step: t('Étape 1 sur 3'), text: t('La vendeuse a créé la commande et envoyé le lien sur WhatsApp. Passez à la cliente pour payer.'), next: 'client' },
  AWAITING_PAYMENT: { step: t('Étape 1 sur 3'), text: real
    ? t('La cliente paie avec son wallet Lightning de test : touchez « Payer avec le wallet de test de la cliente ». C’est un vrai paiement Lightning, avec des sats de test.')
    : t('La cliente paie en Mobile Money : choisissez un opérateur, un numéro, puis validez. Aucun argent réel.'), next: 'client' },
  FUNDS_LOCKED: { step: t('Étape 2 sur 3'), text: t("L'argent est bloqué. Passez au livreur : il reçoit sa mission."), next: 'courier' },
  OUT_FOR_DELIVERY: { step: t('Étape 3 sur 3'), text: t('Chez la cliente, le livreur scanne son sésame. Tout le monde est payé.'), next: 'courier' },
  RELEASED: { step: t('Terminé'), text: real
    ? t('Le sésame a libéré l’argent : la vendeuse et le livreur ont reçu de vrais sats dans leurs propres wallets.')
    : t('La vendeuse et le livreur sont payés, et un reçu vérifiable est publié.'), next: null },
  REFUNDED: { step: t('Terminé'), text: t('La commande a été annulée : la cliente est remboursée.'), next: null },
  EXPIRED: { step: t('Terminé'), text: t("La facture n'a pas été payée à temps."), next: null },
});

/** Barre de guidage affichée au-dessus des écrans de la commande de démo. */
export function DemoBar({ demo, path }: { demo: DemoState; path: string }) {
  const [order, setOrder] = useState<OrderView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balances, setBalances] = useState<Record<'seller' | 'buyer' | 'courier', number | null> | null>(null);
  const id = demo.orderId;

  useEffect(() => {
    document.body.classList.add('demo-on');
    const load = () => api<OrderView>(`/api/orders/${id}`, { token: demo.sellerToken }).then(setOrder).catch(() => undefined);
    void load();
    const stop = subscribe(`/api/orders/${id}/events`, demo.sellerToken, () => void load());
    return () => { stop(); document.body.classList.remove('demo-on'); };
  }, [id]);

  const current: Role = path.startsWith('/c/') ? 'client' : path.startsWith('/l/') ? 'courier' : 'seller';
  const step = order ? guide(demo.real)[order.state] : undefined;

  // Démo réelle : soldes des trois wallets de test, relus à chaque changement d'état.
  useEffect(() => {
    if (!demo.real || !order) return;
    // Le paiement du livreur part quelques secondes après la libération : on relit pendant ~40 s.
    const load = () => api<Record<'seller' | 'buyer' | 'courier', number | null>>(`/api/demo/balances/${id}`, { token: demo.sellerToken }).then(setBalances).catch(() => undefined);
    void load();
    let n = 0;
    const timer = setInterval(() => { if (++n > 8) clearInterval(timer); else void load(); }, 5_000);
    return () => clearInterval(timer);
  }, [order?.state]);
  const paid = order ? ['FUNDS_LOCKED', 'OUT_FOR_DELIVERY', 'RELEASED'].includes(order.state) : false;

  async function open(role: Role) {
    setError(null);
    if (role === 'seller') return navigate(`/v/o/${id}`);
    if (role === 'client') return navigate(`/c/${id}`);
    let token = demo.courierToken;
    if (!token) {
      if (order?.state !== 'FUNDS_LOCKED') return setError(t('Le livreur reçoit sa mission une fois que la cliente a payé.'));
      setBusy(true);
      try {
        const r = await api<{ courierToken: string }>(`/api/orders/${id}/assign`, { token: demo.sellerToken, body: { lightningAddress: demo.courierAddress ?? COURIER_ADDRESS } });
        token = r.courierToken;
        local.set(`sesame:ltok:${id}`, token);
        local.set(`sesame:tok:l:${id}`, token);
        saveDemo({ ...demo, courierToken: token });
      } catch (e) {
        setBusy(false);
        return setError(errorText(e));
      }
      setBusy(false);
    }
    navigate(`/l/${id}`);
  }

  const tabs: Array<{ role: Role; label: string }> = [
    { role: 'seller', label: t('Vendeuse') },
    { role: 'client', label: t('Cliente') },
    { role: 'courier', label: t('Livreur') },
  ];

  return (
    <div class="demo-bar" role="region" aria-label={t('Démo guidée')}>
      <div class="row">
        <strong class="grow">{t('Démo guidée')} <span class="demo-sim">{demo.real ? t('vrais paiements Lightning, sats de test') : t('paiements simulés')}</span></strong>
        <LangToggle dark />
        <button class="demo-quit" onClick={quitDemo}>{t('Quitter')}</button>
      </div>
      {step && (
        <p class="demo-hint" aria-live="polite">
          <b>{step.step}.</b> {step.text}
          {order?.state === 'RELEASED' && <> <a href={`/verify/${demo.slug}`} onClick={(e) => { e.preventDefault(); navigate(`/verify/${demo.slug}`); }}>{t('Voir la réputation')}</a></>}
        </p>
      )}
      <div class="demo-tabs" role="group" aria-label={t('Changer de rôle')}>
        {tabs.map((tab) => (
          <button key={tab.role} aria-pressed={current === tab.role} disabled={busy || (tab.role === 'courier' && !paid && !demo.courierToken)}
            class={step?.next === tab.role && current !== tab.role ? 'next' : ''} onClick={() => void open(tab.role)}>
            {tab.label}
          </button>
        ))}
      </div>
      {demo.real && balances && (
        <p class="demo-hint" aria-live="polite">
          {t('Soldes réels des wallets de test : vendeuse {s} sats · cliente {b} sats · livreur {c} sats', { s: balances.seller ?? '?', b: balances.buyer ?? '?', c: balances.courier ?? '?' })}
        </p>
      )}
      {error && <p class="demo-hint" role="alert">{error}</p>}
    </div>
  );
}

/**
 * « Essayer la démo » : les trois rôles sur un seul téléphone.
 * Le serveur crée une boutique de démonstration jetable ; ce module garde ses jetons localement
 * et affiche une barre de guidage qui dit quoi faire à chaque étape.
 */
import { useEffect, useState } from 'preact/hooks';
import { api, ApiError, local, SELLER_KEY, subscribe, type OrderView } from './api.js';
import { navigate } from './router.js';
import { ErrorBox } from './ui/kit.js';

const DEMO_KEY = 'sesame:demo';
const BEFORE_KEY = 'sesame:seller:before-demo';
const COURIER_ADDRESS = 'moussa@livreur.demo';

export interface DemoState { orderId: string; slug: string; sellerToken: string; clientToken: string; courierToken?: string }

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

async function startDemo(): Promise<DemoState> {
  const d = await api<DemoState>('/api/demo/start', { body: {} });
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
export function DemoStart() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    startDemo()
      .then((d) => navigate(`/v/o/${d.orderId}`))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Impossible de lancer la démo.'));
  }, []);
  return (
    <div class="screen">
      <main class="content" style="justify-content:center;align-items:center;text-align:center;gap:14px">
        {error ? (
          <>
            <ErrorBox message={error} />
            <button class="btn ghost" onClick={() => navigate('/')}>Retour à l'accueil</button>
          </>
        ) : (
          <>
            <h1>Préparation de la démo</h1>
            <p class="muted">Une boutique de démonstration et une commande sont créées pour vous.</p>
          </>
        )}
      </main>
    </div>
  );
}

type Role = 'seller' | 'client' | 'courier';

const GUIDE: Record<string, { step: string; text: string; next: Role | null }> = {
  DRAFT: { step: 'Étape 1 sur 3', text: "La vendeuse a créé la commande et envoyé le lien sur WhatsApp. Passez à la cliente pour payer.", next: 'client' },
  AWAITING_PAYMENT: { step: 'Étape 1 sur 3', text: 'La cliente paie en Mobile Money : choisissez un opérateur, un numéro, puis validez. Aucun argent réel.', next: 'client' },
  FUNDS_LOCKED: { step: 'Étape 2 sur 3', text: "L'argent est bloqué. Passez au livreur : il reçoit sa mission.", next: 'courier' },
  OUT_FOR_DELIVERY: { step: 'Étape 3 sur 3', text: 'Chez la cliente, le livreur scanne son sésame. Tout le monde est payé.', next: 'courier' },
  RELEASED: { step: 'Terminé', text: 'La vendeuse et le livreur sont payés, et un reçu vérifiable est publié.', next: null },
  REFUNDED: { step: 'Terminé', text: 'La commande a été annulée : la cliente est remboursée.', next: null },
  EXPIRED: { step: 'Terminé', text: "La facture n'a pas été payée à temps.", next: null },
};

/** Barre de guidage affichée au-dessus des écrans de la commande de démo. */
export function DemoBar({ demo, path }: { demo: DemoState; path: string }) {
  const [order, setOrder] = useState<OrderView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = demo.orderId;

  useEffect(() => {
    document.body.classList.add('demo-on');
    const load = () => api<OrderView>(`/api/orders/${id}`, { token: demo.sellerToken }).then(setOrder).catch(() => undefined);
    void load();
    const stop = subscribe(`/api/orders/${id}/events`, demo.sellerToken, () => void load());
    return () => { stop(); document.body.classList.remove('demo-on'); };
  }, [id]);

  const current: Role = path.startsWith('/c/') ? 'client' : path.startsWith('/l/') ? 'courier' : 'seller';
  const guide = order ? GUIDE[order.state] : undefined;
  const paid = order ? ['FUNDS_LOCKED', 'OUT_FOR_DELIVERY', 'RELEASED'].includes(order.state) : false;

  async function open(role: Role) {
    setError(null);
    if (role === 'seller') return navigate(`/v/o/${id}`);
    if (role === 'client') return navigate(`/c/${id}`);
    let token = demo.courierToken;
    if (!token) {
      if (order?.state !== 'FUNDS_LOCKED') return setError("Le livreur reçoit sa mission une fois que la cliente a payé.");
      setBusy(true);
      try {
        const r = await api<{ courierToken: string }>(`/api/orders/${id}/assign`, { token: demo.sellerToken, body: { lightningAddress: COURIER_ADDRESS } });
        token = r.courierToken;
        local.set(`sesame:ltok:${id}`, token);
        local.set(`sesame:tok:l:${id}`, token);
        saveDemo({ ...demo, courierToken: token });
      } catch (e) {
        setBusy(false);
        return setError(e instanceof ApiError ? e.message : 'Une erreur est survenue.');
      }
      setBusy(false);
    }
    navigate(`/l/${id}`);
  }

  const tabs: Array<{ role: Role; label: string }> = [
    { role: 'seller', label: 'Vendeuse' },
    { role: 'client', label: 'Cliente' },
    { role: 'courier', label: 'Livreur' },
  ];

  return (
    <div class="demo-bar" role="region" aria-label="Démo guidée">
      <div class="row">
        <strong class="grow">Démo guidée <span class="demo-sim">paiements simulés</span></strong>
        <button class="demo-quit" onClick={quitDemo}>Quitter</button>
      </div>
      {guide && (
        <p class="demo-hint" aria-live="polite">
          <b>{guide.step}.</b> {guide.text}
          {order?.state === 'RELEASED' && <> <a href={`/verify/${demo.slug}`} onClick={(e) => { e.preventDefault(); navigate(`/verify/${demo.slug}`); }}>Voir la réputation</a></>}
        </p>
      )}
      <div class="demo-tabs" role="group" aria-label="Changer de rôle">
        {tabs.map((t) => (
          <button key={t.role} aria-pressed={current === t.role} disabled={busy || (t.role === 'courier' && !paid && !demo.courierToken)}
            class={guide?.next === t.role && current !== t.role ? 'next' : ''} onClick={() => void open(t.role)}>
            {t.label}
          </button>
        ))}
      </div>
      {error && <p class="demo-hint" role="alert">{error}</p>}
    </div>
  );
}

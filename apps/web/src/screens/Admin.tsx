/**
 * Administration (/admin) : suivi de l'activité, alertes, suspension d'une boutique.
 * Aucune action sur l'argent : les fonds ne dépendent que du sésame du client et de l'échéance.
 * La session est gardée pour l'onglet seulement (sessionStorage).
 */
import { useCallback, useEffect, useState } from 'preact/hooks';
import { api, ApiError, xof } from '../api.js';
import { Logout, Shield } from '../ui/icons.js';
import { Brand, ErrorBox, Toast, useToast } from '../ui/kit.js';

const KEY = 'sesame:admin';
const session = {
  get: () => { try { return sessionStorage.getItem(KEY); } catch { return null; } },
  set: (t: string) => { try { sessionStorage.setItem(KEY, t); } catch { /* ignoré */ } },
  clear: () => { try { sessionStorage.removeItem(KEY); } catch { /* ignoré */ } },
};

type State = 'DRAFT' | 'AWAITING_PAYMENT' | 'FUNDS_LOCKED' | 'OUT_FOR_DELIVERY' | 'RELEASED' | 'REFUNDED' | 'EXPIRED';

interface Overview {
  mode: string;
  totals: { shops: number; demoShops: number; orders: number; demoOrders: number; releasedXof: number; feesXof: number; lockedXof: number; successRate: number | null };
  byState: Record<State, number>;
  usage: {
    activeShops7d: number; activeShops30d: number; newShops7d: number; avgBasketXof: number | null;
    funnel: { created: number; paid: number; released: number };
    daily: Array<{ date: string; created: number; released: number; volumeXof: number }>;
    since: string;
    demos: { real: number; simulated: number };
    ai: { textLlm: number; textRules: number; imageOk: number; imageFail: number };
  };
  alerts: { auditChainOk: boolean; auditBrokenAt: number | null; auditEntries: number; overdue: number; payoutsFailed: number; payoutsPending: number; settlePending: number };
  shops: Array<{ id: string; slug: string; name: string; city: string; createdAt: string; suspended: boolean; demo: boolean; orders: number; released: number; volumeXof: number }>;
  recent: Array<{ seq: number; at: string; event: string; order: string; state: string | null }>;
}

const STATE_LABEL: Record<State, string> = {
  DRAFT: 'Brouillon', AWAITING_PAYMENT: 'En attente de paiement', FUNDS_LOCKED: 'Paiement sécurisé',
  OUT_FOR_DELIVERY: 'En livraison', RELEASED: 'Livrée et payée', REFUNDED: 'Remboursée', EXPIRED: 'Expirée',
};

const EVENT_LABEL: Record<string, string> = {
  ORDER_CREATED: 'Commande créée', INVOICE_ISSUED: 'Facture émise', FUNDS_LOCKED: 'Paiement bloqué',
  AMOUNT_MISMATCH: 'Montant incorrect, remboursé', COURIER_ASSIGNED: 'Livreur assigné', SETTLE_PENDING: 'Règlement en cours',
  SETTLE_ABANDONED: 'Règlement abandonné', RELEASED: 'Livrée et payée', REFUNDED: 'Remboursée', EXPIRED: 'Facture expirée',
  PAYOUT_SENT: 'Paiement envoyé', PAYOUT_FAILED: 'Paiement en échec', PAYOUT_ABANDONED: 'Paiement abandonné',
  SHOP_SUSPENDED: 'Boutique suspendue', SHOP_REINSTATED: 'Boutique réactivée',
};

export function Admin() {
  const [token, setToken] = useState(session.get);
  const logout = () => { session.clear(); setToken(null); };
  return token ? <Dashboard token={token} onLogout={logout} /> : <Login onToken={(t) => { session.set(t); setToken(t); }} />;
}

function Login({ onToken }: { onToken: (t: string) => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: Event) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ adminToken: string }>('/api/admin/login', { body: { code } });
      onToken(r.adminToken);
    } catch (err) {
      setError(err instanceof ApiError ? (err.status === 404 ? "L'administration n'est pas activée sur ce serveur." : err.message) : 'Une erreur est survenue.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="screen">
      <header class="top"><Brand /></header>
      <main class="content fade-in">
        <div class="stack" style="gap:8px;padding-top:6px">
          <h1>Administration</h1>
          <p class="muted">Suivi de l'activité de Sésame. L'administration ne peut ni déplacer, ni bloquer, ni rembourser l'argent des clients.</p>
        </div>
        <form class="stack" onSubmit={submit}>
          <div class="field">
            <label for="code">Code d'accès</label>
            <input id="code" class="input" type="password" value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} autocomplete="current-password" required />
          </div>
          {error && <ErrorBox message={error} />}
          <button class="btn primary" disabled={busy || code.length < 1}>Se connecter</button>
        </form>
      </main>
    </div>
  );
}

function Dashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDemo, setShowDemo] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    try {
      setData(await api<Overview>('/api/admin/overview', { token }));
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onLogout();
      setError(e instanceof ApiError ? e.message : 'Erreur de chargement.');
    }
  }, [token]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);

  async function suspend(id: string, suspended: boolean) {
    try {
      await api(`/api/admin/shops/${id}/suspend`, { token, body: { suspended } });
      showToast(suspended ? 'Boutique suspendue' : 'Boutique réactivée');
      setConfirm(null);
      await load();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Action impossible');
    }
  }

  if (!data) return <div class="screen"><header class="top"><Brand /></header><div class="content">{error ? <ErrorBox message={error} /> : <p class="muted center">Chargement…</p>}</div></div>;

  const { totals, alerts } = data;
  const maxState = Math.max(1, ...Object.values(data.byState));
  const shops = data.shops.filter((s) => showDemo || !s.demo);
  const alertRows: Array<{ ok: boolean; title: string; text: string }> = [
    {
      ok: alerts.auditChainOk,
      title: alerts.auditChainOk ? "Journal d'audit intact" : "Journal d'audit modifié",
      text: alerts.auditChainOk ? `${alerts.auditEntries} entrées, chaîne de hachage vérifiée` : `Rupture de la chaîne à l'entrée n° ${alerts.auditBrokenAt}`,
    },
    {
      ok: alerts.overdue === 0,
      title: alerts.overdue === 0 ? 'Aucun remboursement en retard' : `${alerts.overdue} remboursement(s) en retard`,
      text: 'Commandes bloquées dont l’échéance est passée',
    },
    {
      ok: alerts.payoutsFailed === 0,
      title: alerts.payoutsFailed === 0 ? 'Aucun paiement en échec' : `${alerts.payoutsFailed} paiement(s) en échec`,
      text: `Livreurs et frais${alerts.payoutsPending ? `, ${alerts.payoutsPending} en cours de réessai` : ''}`,
    },
    {
      ok: alerts.settlePending === 0,
      title: alerts.settlePending === 0 ? 'Aucun règlement en attente' : `${alerts.settlePending} règlement(s) en attente`,
      text: 'Livraisons confirmées, wallet de la vendeuse pas encore joint',
    },
  ];

  return (
    <div class="screen">
      <main class="content fade-in" style="padding-top:max(14px, env(safe-area-inset-top))">
        <header class="row">
          <Brand />
          <span class="admin-tag">Admin</span>
          <span class="grow" />
          <button class="icon-btn" aria-label="Se déconnecter" title="Se déconnecter" onClick={onLogout}><Logout /></button>
        </header>
        {data.mode === 'simulation' && <div class="card warn small">Serveur en mode démonstration : les paiements sont simulés.</div>}

        <section class="band">
          <div>
            <div class="label-on-dark">Volume livré et payé</div>
            <div class="band-amount" style="margin-top:6px">{xof(totals.releasedXof)}</div>
          </div>
          <div class="figures">
            <div><b>{totals.shops}</b><span>boutiques</span></div>
            <div><b>{totals.orders}</b><span>commandes</span></div>
            <div><b style="color:var(--saffron)">{new Intl.NumberFormat('fr-FR').format(totals.feesXof)}</b><span>FCFA de frais gagnés</span></div>
          </div>
          <div class="tiny" style="color:#C7CBF0">
            {xof(totals.lockedXof)} bloqués en ce moment{totals.successRate !== null ? `, ${totals.successRate} % de livraisons réussies` : ''}.
            {totals.demoShops > 0 && ` Hors démo : ${totals.demoShops} boutique(s) et ${totals.demoOrders} commande(s) de démonstration.`}
          </div>
        </section>

        <h2 class="section-title">Utilisation</h2>
        <div class="kpis">
          <div class="kpi"><b>{data.usage.activeShops7d}</b><span>vendeuses actives (7 j)</span></div>
          <div class="kpi"><b>{data.usage.activeShops30d}</b><span>vendeuses actives (30 j)</span></div>
          <div class="kpi"><b>{data.usage.newShops7d}</b><span>nouvelles boutiques (7 j)</span></div>
          <div class="kpi"><b>{data.usage.avgBasketXof === null ? '–' : xof(data.usage.avgBasketXof)}</b><span>panier moyen livré</span></div>
        </div>

        <h2 class="section-title">Ventes des 14 derniers jours</h2>
        <div class="card stack" style="gap:8px">
          {(() => {
            const max = Math.max(1, ...data.usage.daily.map((d) => d.created));
            return (
              <div class="daychart" role="img" aria-label="Commandes créées et livrées par jour, 14 derniers jours">
                {data.usage.daily.map((d) => (
                  <div key={d.date} class="daycol" title={`${d.date} : ${d.created} créée(s), ${d.released} livrée(s), ${xof(d.volumeXof)}`}>
                    <span class="daybar" style={`height:${(d.created / max) * 100}%`}>
                      <span class="daybar-ok" style={`height:${d.created ? (d.released / d.created) * 100 : 0}%`} />
                    </span>
                    <span class="daylabel">{d.date.slice(8)}</span>
                  </div>
                ))}
              </div>
            );
          })()}
          <div class="tiny muted"><span class="legend created" /> créées · <span class="legend ok" /> livrées et payées</div>
        </div>

        <h2 class="section-title">Parcours des commandes</h2>
        <div class="card stack" style="gap:10px">
          {([['Créées', data.usage.funnel.created], ['Payées (argent bloqué)', data.usage.funnel.paid], ['Livrées et payées', data.usage.funnel.released]] as const).map(([label, n]) => (
            <div key={label} class="bar-row">
              <span class="small">{label}</span>
              <span class="bar"><span class="bar-fill RELEASED" style={`width:${(n / Math.max(1, data.usage.funnel.created)) * 100}%`} /></span>
              <b class="num small">{n}</b>
            </div>
          ))}
        </div>

        <h2 class="section-title">Démo et IA</h2>
        <div class="kpis">
          <div class="kpi"><b>{data.usage.demos.real}</b><span>démos Lightning réelles</span></div>
          <div class="kpi"><b>{data.usage.demos.simulated}</b><span>démos simulées</span></div>
          <div class="kpi"><b>{data.usage.ai.textLlm}</b><span>commandes lues par l’IA{data.usage.ai.textRules ? ` (+${data.usage.ai.textRules} par les règles)` : ''}</span></div>
          <div class="kpi"><b>{data.usage.ai.imageOk}</b><span>captures lues{data.usage.ai.imageFail ? ` (${data.usage.ai.imageFail} échec(s))` : ''}</span></div>
        </div>
        <div class="tiny muted">Compteurs depuis le dernier démarrage du serveur ({new Date(data.usage.since).toLocaleString('fr-FR')}).</div>

        <h2 class="section-title">Alertes</h2>
        <div class="list">
          {alertRows.map((a) => (
            <div key={a.title} class="list-row">
              <span class={`alert-dot ${a.ok ? 'ok' : 'bad'}`} aria-hidden="true" />
              <div class="grow">
                <div class="title" style="white-space:normal">{a.title}</div>
                <div class="tiny muted">{a.text}</div>
              </div>
            </div>
          ))}
        </div>

        <h2 class="section-title">Commandes par état</h2>
        <div class="card stack" style="gap:10px">
          {(Object.keys(STATE_LABEL) as State[]).map((s) => (
            <div key={s} class="bar-row">
              <span class="small">{STATE_LABEL[s]}</span>
              <span class="bar"><span class={`bar-fill ${s}`} style={`width:${(data.byState[s] / maxState) * 100}%`} /></span>
              <b class="num small">{data.byState[s]}</b>
            </div>
          ))}
        </div>

        <div class="row" style="margin-top:6px">
          <h2 class="section-title grow" style="margin:0">Boutiques</h2>
          <label class="row small" style="gap:6px;cursor:pointer">
            <input type="checkbox" checked={showDemo} onChange={(e) => setShowDemo((e.target as HTMLInputElement).checked)} /> Démo
          </label>
        </div>
        <div class="list">
          {shops.length === 0 && <div class="list-empty">Aucune boutique pour l'instant.</div>}
          {shops.map((s) => (
            <div key={s.id} class="shop-row">
              <div class="row" style="align-items:flex-start">
                <div class="grow">
                  <div class="title" style="font-weight:700">{s.name}</div>
                  <div class="tiny muted">{s.city}, identifiant {s.slug}</div>
                </div>
                {s.suspended && <span class="pill REFUNDED">Suspendue</span>}
                {s.demo && <span class="pill DRAFT">Démo</span>}
              </div>
              <div class="tiny muted">
                {s.orders} commande{s.orders > 1 ? 's' : ''}, {s.released} livrée{s.released > 1 ? 's' : ''}, <span class="num">{xof(s.volumeXof)}</span>
              </div>
              {confirm === s.id ? (
                <div class="card warn stack small" style="gap:8px">
                  <span>{s.suspended
                    ? 'Réactiver la boutique ? Elle pourra de nouveau se connecter et créer des commandes.'
                    : "Suspendre la boutique ? Elle ne pourra plus se connecter ni créer de commandes, et ses clients ne pourront plus payer. Les commandes déjà payées restent protégées : livrées ou remboursées automatiquement."}</span>
                  <div class="row">
                    <button class="btn dark" style="min-height:44px" onClick={() => void suspend(s.id, !s.suspended)}>{s.suspended ? 'Réactiver' : 'Suspendre'}</button>
                    <button class="btn ghost" style="min-height:44px" onClick={() => setConfirm(null)}>Annuler</button>
                  </div>
                </div>
              ) : (
                <button class="btn quiet" style="align-self:flex-start;width:auto;padding-left:0;min-height:36px" onClick={() => setConfirm(s.id)}>
                  {s.suspended ? 'Réactiver la boutique' : 'Suspendre la boutique'}
                </button>
              )}
            </div>
          ))}
        </div>

        <h2 class="section-title">Activité récente</h2>
        <div class="list">
          {data.recent.length === 0 && <div class="list-empty">Aucune activité pour l'instant.</div>}
          {data.recent.map((r) => (
            <div key={r.seq} class="list-row" style="min-height:52px">
              <div class="grow">
                <div class="small" style="font-weight:700">{EVENT_LABEL[r.event] ?? r.event}</div>
                <div class="tiny muted">{r.order.startsWith('shop:') ? 'Boutique' : `Commande ${r.order.toUpperCase()}`}</div>
              </div>
              <span class="tiny muted num">{new Date(r.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          ))}
        </div>

        <p class="tiny muted center" style="display:flex;gap:6px;justify-content:center;align-items:center">
          <Shield size={14} color="var(--muted)" /> Aucun sésame, jeton ni numéro de téléphone n'est visible ici.
        </p>
        {error && <ErrorBox message={error} />}
      </main>
      <Toast text={toast} />
    </div>
  );
}

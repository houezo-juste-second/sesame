/** Espace vendeuse : connexion, tableau de bord, nouvelle commande (avec IA), détail d'une commande. */
import { useCallback, useEffect, useState } from 'preact/hooks';
import { serviceFeeXof } from '@sesame/core';
import { api, ApiError, initials, local, SELLER_KEY, subscribe, xof, type OrderView } from '../api.js';
import { navigate } from '../router.js';
import { Chevron, Logout, Plus, Shield, Sparkle, WhatsApp } from '../ui/icons.js';
import { copyText, ErrorBox, Loading, SimBanner, Toast, TopBar, useToast, whatsappUrl } from '../ui/kit.js';

const clientTokKey = (id: string) => `sesame:ctok:${id}`;
const courierTokKey = (id: string) => `sesame:ltok:${id}`;

function useSellerToken(): [string | null, (t: string | null) => void] {
  const [token, setToken] = useState(() => local.get(SELLER_KEY));
  return [token, (t) => {
    if (t) local.set(SELLER_KEY, t); else local.remove(SELLER_KEY);
    setToken(t);
  }];
}

const linkFor = (role: 'c' | 'l', id: string, token: string) => `${location.origin}/${role}/${id}#t=${token}`;

// ================================================================ connexion

export function SellerHome() {
  const [token, setToken] = useSellerToken();
  return token ? <Dashboard token={token} onLogout={() => setToken(null)} /> : <SellerAuth onToken={setToken} />;
}

function SellerAuth({ onToken }: { onToken: (t: string) => void }) {
  const [mode, setMode] = useState<'login' | 'create'>('login');
  const [form, setForm] = useState({ slug: '', name: '', city: '', pin: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: Event) => setForm({ ...form, [k]: (e.target as HTMLInputElement).value });

  async function submit(e: Event) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = mode === 'login'
        ? await api<{ sellerToken: string }>('/api/shops/login', { body: { slug: form.slug.trim(), pin: form.pin } })
        : await api<{ sellerToken: string }>('/api/shops', { body: { name: form.name, city: form.city, pin: form.pin } });
      onToken(r.sellerToken);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="screen">
      <TopBar />
      <main class="content fade-in">
        <div class="stack" style="gap:8px;padding-top:6px">
          <h1>Espace vendeuse</h1>
          <p class="muted">Encaissez avant la livraison, sans risque pour vos clients.</p>
        </div>
        <div class="segmented" role="group" aria-label="Choix">
          <button type="button" aria-pressed={mode === 'login'} onClick={() => setMode('login')}>Se connecter</button>
          <button type="button" aria-pressed={mode === 'create'} onClick={() => setMode('create')}>Créer ma boutique</button>
        </div>
        <form class="stack" onSubmit={submit}>
          {mode === 'login' ? (
            <div class="field">
              <label for="slug">Identifiant de la boutique</label>
              <input id="slug" class="input" value={form.slug} onInput={set('slug')} placeholder="pagnes-de-fifame" autocomplete="username" required />
            </div>
          ) : (
            <>
              <div class="field"><label for="name">Nom de la boutique</label><input id="name" class="input" value={form.name} onInput={set('name')} placeholder="Pagnes de Fifamè" required minLength={2} maxLength={60} /></div>
              <div class="field"><label for="city">Ville</label><input id="city" class="input" value={form.city} onInput={set('city')} placeholder="Cotonou" required minLength={2} maxLength={40} /></div>
            </>
          )}
          <div class="field">
            <label for="pin">Code PIN (4 à 6 chiffres)</label>
            <input id="pin" class="input" type="password" inputMode="numeric" pattern="[0-9]{4,6}" value={form.pin} onInput={set('pin')} autocomplete={mode === 'login' ? 'current-password' : 'new-password'} required />
          </div>
          {error && <ErrorBox message={error} />}
          <button class="btn primary" disabled={busy}>{mode === 'login' ? 'Se connecter' : 'Créer ma boutique'}</button>
        </form>
      </main>
    </div>
  );
}

// ================================================================ tableau de bord

interface Dash {
  shop: { name: string; slug: string; city: string };
  orders: OrderView[];
  summary: { releasedXof: number; releasedCount: number; lockedXof: number; inDeliveryCount: number };
}

function Dashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [data, setData] = useState<Dash | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Dash>('/api/shops/me/orders', { token }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onLogout();
      setError(e instanceof ApiError ? e.message : 'Erreur de chargement.');
    }
  }, [token]);

  useEffect(() => {
    void load();
    return subscribe('/api/shops/me/events', token, () => void load());
  }, [load, token]);

  if (!data) return <div class="screen"><TopBar />{error ? <div class="content"><ErrorBox message={error} /></div> : <Loading />}</div>;
  const simulation = data.orders[0]?.simulation ?? false;

  const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 0 });
  const time = (d: string) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div class="screen">
      <SimBanner show={simulation} />
      <main class="content fade-in" style="padding-top:max(14px, env(safe-area-inset-top))">
        <section class="band">
          <div class="row" style="gap:12px">
            <div class="avatar" style="width:44px;height:44px;font-size:16px" aria-hidden="true">{initials(data.shop.name)}</div>
            <div class="grow">
              <h2 style="overflow-wrap:anywhere">{data.shop.name}</h2>
              <div class="tiny" style="color:#C7CBF0;overflow-wrap:anywhere">Identifiant : {data.shop.slug}</div>
            </div>
            <button class="icon-btn" aria-label="Se déconnecter" title="Se déconnecter" onClick={onLogout}><Logout /></button>
          </div>
          <div>
            <div class="label-on-dark">Encaissé sur les commandes livrées</div>
            <div class="band-amount" style="margin-top:6px">{xof(data.summary.releasedXof)}</div>
          </div>
          <div class="figures">
            <div><b>{data.summary.releasedCount}</b><span>livrées</span></div>
            <div><b style="color:var(--saffron)">{data.summary.inDeliveryCount}</b><span>en livraison</span></div>
            <div><b>{compact.format(data.summary.lockedXof)}</b><span>FCFA bloqués pour vous</span></div>
          </div>
        </section>

        <a class="link-row" href={`/verify/${data.shop.slug}`} target="_blank" rel="noopener">
          <span class="link-icon"><Shield size={18} color="var(--indigo)" /></span>
          <span class="grow">
            <strong style="display:block;font-size:15px">Ma réputation publique</strong>
            <span class="tiny muted">Des reçus vérifiables, à partager avec vos clients</span>
          </span>
          <span class="chev"><Chevron /></span>
        </a>

        <h2 class="section-title">Commandes</h2>
        <div class="list">
          {data.orders.length === 0 && (
            <div class="list-empty">Aucune commande pour l'instant. Créez-en une, puis envoyez le lien à votre client sur WhatsApp.</div>
          )}
          {data.orders.map((o) => (
            <a key={o.id} class="list-row" href={`/v/o/${o.id}`} onClick={(e) => { e.preventDefault(); navigate(`/v/o/${o.id}`); }}>
              <div class="grow">
                <div class="title">{o.itemLabel}</div>
                <div class="tiny muted">{time(o.createdAt)}, {o.courierAssigned ? 'livreur assigné' : 'sans livreur'}</div>
              </div>
              <div style="text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:3px">
                <span class="amount">{new Intl.NumberFormat('fr-FR').format(o.totalXof)}</span>
                <span class={`status ${o.state}`}>{o.stateLabel}</span>
              </div>
            </a>
          ))}
        </div>
      </main>
      <footer class="bottom">
        <a class="btn primary" href="/v/new" onClick={(e) => { e.preventDefault(); navigate('/v/new'); }}><Plus /> Nouvelle commande</a>
      </footer>
    </div>
  );
}

// ================================================================ nouvelle commande

export function SellerNewOrder() {
  const [token] = useSellerToken();
  const [chat, setChat] = useState('');
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [form, setForm] = useState({ itemLabel: '', itemXof: '', deliveryFeeXof: '', deliveryHours: 6 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!token) navigate('/v'); }, [token]);
  if (!token) return null;

  const num = (s: string) => Number(s.replace(/[^\d]/g, '')) || 0;
  const item = num(form.itemXof);
  const delivery = num(form.deliveryFeeXof);
  const fee = item > 0 ? serviceFeeXof(item) : 0;

  async function fill() {
    setBusy(true);
    setAiNote(null);
    try {
      const r = await api<{ itemLabel: string | null; amountXof: number | null; deliveryFeeXof: number | null; deadlineHours: number; missingFields: string[] }>(
        '/api/ai/extract-order', { token, body: { text: chat } });
      setForm({
        itemLabel: r.itemLabel ?? form.itemLabel,
        itemXof: r.amountXof ? String(r.amountXof) : form.itemXof,
        deliveryFeeXof: r.deliveryFeeXof !== null ? String(r.deliveryFeeXof) : form.deliveryFeeXof,
        deliveryHours: [2, 6, 12].includes(r.deadlineHours) ? r.deadlineHours : 6,
      });
      const labels: Record<string, string> = { itemLabel: "l'article", amountXof: 'le prix', deliveryFeeXof: 'les frais de livraison' };
      setAiNote(r.missingFields.length
        ? `À compléter : ${r.missingFields.map((f) => labels[f]).join(', ')}. Vérifiez avant de créer.`
        : 'Champs remplis automatiquement. Vérifiez-les avant de créer la commande.');
    } catch (e) {
      setAiNote(e instanceof ApiError ? e.message : 'Extraction impossible, remplissez le formulaire.');
    } finally {
      setBusy(false);
    }
  }

  async function create(e: Event) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ order: OrderView; clientToken: string }>('/api/orders', {
        token, body: { itemLabel: form.itemLabel, itemXof: item, deliveryFeeXof: delivery, deliveryHours: form.deliveryHours },
      });
      local.set(clientTokKey(r.order.id), r.clientToken);
      navigate(`/v/o/${r.order.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue.');
      setBusy(false);
    }
  }

  return (
    <div class="screen">
      <TopBar back="/v" title="Nouvelle commande" />
      <form class="content fade-in" onSubmit={create}>
        <section class="ai-box">
          <div class="row" style="gap:8px">
            <Sparkle color="var(--indigo)" /><h3 style="color:var(--indigo-ink)">Remplir depuis la conversation</h3>
          </div>
          <label class="hint" for="chat">Collez les messages WhatsApp du client. Les numéros de téléphone sont masqués automatiquement.</label>
          <textarea id="chat" class="input" value={chat} maxLength={4000} onInput={(e) => setChat((e.target as HTMLTextAreaElement).value)}
            placeholder="Je prends les 2 pagnes bleus à 18 000, livraison à Fidjrossè 1 500" />
          <button type="button" class="btn ghost" disabled={busy || chat.trim().length < 5} onClick={fill}>Remplir automatiquement</button>
          {aiNote && <div class="hint" role="status">{aiNote}</div>}
        </section>

        <div class="field">
          <label for="item">Article</label>
          <input id="item" class="input" value={form.itemLabel} maxLength={120} required onInput={(e) => setForm({ ...form, itemLabel: (e.target as HTMLInputElement).value })} />
        </div>
        <div class="row" style="gap:10px;align-items:flex-start">
          <div class="field" style="flex:1"><label for="price">Prix (FCFA)</label>
            <input id="price" class="input" inputMode="numeric" required value={form.itemXof} onInput={(e) => setForm({ ...form, itemXof: (e.target as HTMLInputElement).value })} /></div>
          <div class="field" style="flex:1"><label for="deliv">Livraison (FCFA)</label>
            <input id="deliv" class="input" inputMode="numeric" value={form.deliveryFeeXof} onInput={(e) => setForm({ ...form, deliveryFeeXof: (e.target as HTMLInputElement).value })} /></div>
        </div>
        <div class="field">
          <span class="label" id="delai">Délai de livraison</span>
          <div class="segmented" role="group" aria-labelledby="delai">
            {[2, 6, 12].map((h) => (
              <button type="button" key={h} aria-pressed={form.deliveryHours === h} onClick={() => setForm({ ...form, deliveryHours: h })}>{h} h</button>
            ))}
          </div>
        </div>
        {item > 0 && (
          <section class="card stack small" style="gap:8px">
            <div class="between"><span class="muted">Le client paie</span><strong>{xof(item + delivery)}</strong></div>
            {delivery > 0 && <div class="between"><span class="muted">Part du livreur</span><span>− {xof(delivery)}</span></div>}
            <div class="between"><span class="muted">Frais Sésame (1 %, seulement si livré)</span><span>− {xof(fee)}</span></div>
            <div class="divider" />
            <div class="between"><span style="font-weight:700">Vous recevez</span><strong class="big-amount" style="color:var(--leaf)">{xof(item - fee)}</strong></div>
          </section>
        )}
        {error && <ErrorBox message={error} />}
        <button class="btn success" disabled={busy || !form.itemLabel || item <= 0}>Créer la commande</button>
      </form>
    </div>
  );
}

// ================================================================ détail d'une commande

export function SellerOrder({ id }: { id: string }) {
  const [token] = useSellerToken();
  const [order, setOrder] = useState<OrderView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setOrder(await api<OrderView>(`/api/orders/${id}`, { token }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erreur de chargement.');
    }
  }, [id, token]);

  useEffect(() => {
    if (!token) { navigate('/v'); return; }
    void load();
    return subscribe(`/api/orders/${id}/events`, token, () => void load());
  }, [load, id, token]);

  if (!token) return null;
  if (!order) return <div class="screen"><TopBar back="/v" />{error ? <div class="content"><ErrorBox message={error} /></div> : <Loading />}</div>;

  const clientTok = local.get(clientTokKey(id));
  const courierTok = local.get(courierTokKey(id));
  const clientLink = clientTok ? linkFor('c', id, clientTok) : null;
  const courierLink = courierTok ? linkFor('l', id, courierTok) : null;
  const active = ['AWAITING_PAYMENT', 'FUNDS_LOCKED', 'OUT_FOR_DELIVERY'].includes(order.state);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try { await fn(); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Une erreur est survenue.'); }
    finally { setBusy(false); }
  }

  const clientMsg = `Bonjour ! Voici votre commande « ${order.itemLabel} » chez ${order.shopName} : ${xof(order.totalXof)}. ` +
    `Payez en toute sécurité : votre argent reste bloqué jusqu'à la livraison, sinon vous êtes remboursé automatiquement. ${clientLink}`;
  const courierMsg = `Mission Sésame : livrer « ${order.itemLabel} ». Votre course : ${xof(order.deliveryFeeXof)}, payée dès le scan du sésame du client. ${courierLink}`;

  return (
    <div class="screen">
      <SimBanner show={order.simulation} />
      <TopBar back="/v" subtitle={`Commande n° ${order.id.slice(0, 4).toUpperCase()}`} title={order.itemLabel}
        right={<span class={`pill ${order.state}`}>{order.stateLabel}</span>} />
      <main class="content fade-in">
        <section class="card stack small" style="gap:6px">
          <div class="between"><span class="muted">Le client paie</span><strong>{xof(order.totalXof)}</strong></div>
          <div class="between"><span class="muted">Frais Sésame</span><span>− {xof(order.feeXof ?? 0)}</span></div>
          {order.courierAssigned && <div class="between"><span class="muted">Livreur ({order.courierAddress})</span><span>− {xof(order.deliveryFeeXof)}</span></div>}
          <div class="divider" />
          <div class="between"><span style="font-weight:700">Vous recevez à la livraison</span><strong class="big-amount" style="color:var(--leaf)">{xof(order.netXof ?? 0)}</strong></div>
        </section>

        {clientLink && (order.state === 'DRAFT' || order.state === 'AWAITING_PAYMENT') && (
          <section class="card stack">
            <h3>Envoyez le lien de paiement au client</h3>
            <a class="btn success" href={whatsappUrl(clientMsg)} target="_blank" rel="noopener noreferrer"><WhatsApp /> Envoyer sur WhatsApp</a>
            <button class="btn ghost" onClick={async () => showToast((await copyText(clientLink)) ? 'Lien copié' : 'Copie impossible')}>Copier le lien</button>
          </section>
        )}

        {order.state === 'FUNDS_LOCKED' && (
          <section class="card stack">
            <h3>Paiement sécurisé. Confiez le colis à un livreur.</h3>
            <div class="field">
              <label for="ln">Adresse Lightning du livreur (pour lui verser sa course)</label>
              <input id="ln" class="input" value={address} onInput={(e) => setAddress((e.target as HTMLInputElement).value)} placeholder="moussa@walletofsatoshi.com" autocomplete="off" />
            </div>
            <button class="btn primary" disabled={busy || address.length < 5} onClick={() => act(async () => {
              const r = await api<{ courierToken: string }>(`/api/orders/${id}/assign`, { token, body: { lightningAddress: address } });
              local.set(courierTokKey(id), r.courierToken);
            })}>Assigner le livreur</button>
            <div class="hint">Le client peut aussi confirmer lui-même la réception, sans livreur.</div>
          </section>
        )}

        {courierLink && order.state === 'OUT_FOR_DELIVERY' && (
          <section class="card stack">
            <h3>Envoyez sa mission au livreur</h3>
            <a class="btn success" href={whatsappUrl(courierMsg)} target="_blank" rel="noopener noreferrer"><WhatsApp /> Envoyer au livreur</a>
            <button class="btn ghost" onClick={async () => showToast((await copyText(courierLink)) ? 'Lien copié' : 'Copie impossible')}>Copier le lien</button>
          </section>
        )}

        {order.state === 'RELEASED' && <div class="card ok small">Livrée et payée. Le livreur et les frais ont été réglés automatiquement.</div>}
        {order.state === 'REFUNDED' && <div class="card danger small">Remboursée : le client a récupéré son argent.</div>}

        {active && (confirmCancel ? (
          <section class="card warn stack small">
            <strong>Annuler la commande ?</strong>
            <span>Le client sera remboursé immédiatement. Cette action est définitive.</span>
            <button class="btn dark" disabled={busy} onClick={() => act(() => api(`/api/orders/${id}/cancel`, { token, body: {} }))}>Oui, annuler et rembourser</button>
            <button class="btn ghost" onClick={() => setConfirmCancel(false)}>Non</button>
          </section>
        ) : (
          <button class="btn quiet" onClick={() => setConfirmCancel(true)}>Annuler la commande et rembourser le client</button>
        ))}
        {error && <ErrorBox message={error} />}
      </main>
      <Toast text={toast} />
    </div>
  );
}

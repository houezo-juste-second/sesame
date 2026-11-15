/** Espace vendeuse : connexion, tableau de bord, nouvelle commande (avec IA), détail d'une commande. */
import { useCallback, useEffect, useState } from 'preact/hooks';
import { serviceFeeXof } from '@sesame/core';
import { api, ApiError, initials, local, MOMO_OPERATORS, SELLER_KEY, subscribe, xof, type OrderView } from '../api.js';
import { navigate } from '../router.js';
import { Bolt, Chevron, Logout, Phone, Plus, Shield, Sparkle, WhatsApp } from '../ui/icons.js';
import type { Scanner as ScannerType } from '../ui/Scanner.js';
import { copyText, ErrorBox, LangToggle, Loading, SimBanner, Toast, TopBar, useToast, whatsappUrl } from '../ui/kit.js';
import { errorText, locale, stateLabel, t } from '../i18n.js';
import { clientMessage, courierMessage } from '../ui/messages.js';

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
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="screen">
      <TopBar />
      <main class="content fade-in">
        <div class="stack" style="gap:8px;padding-top:6px">
          <h1>{t('Espace vendeuse')}</h1>
          <p class="muted">{t('Encaissez avant la livraison, sans risque pour vos clients.')}</p>
        </div>
        <div class="segmented" role="group" aria-label={t('Choix')}>
          <button type="button" aria-pressed={mode === 'login'} onClick={() => setMode('login')}>{t('Se connecter')}</button>
          <button type="button" aria-pressed={mode === 'create'} onClick={() => setMode('create')}>{t('Créer ma boutique')}</button>
        </div>
        <form class="stack" onSubmit={submit}>
          {mode === 'login' ? (
            <div class="field">
              <label for="slug">{t('Identifiant de la boutique')}</label>
              <input id="slug" class="input" value={form.slug} onInput={set('slug')} placeholder="pagnes-de-fifame" autocomplete="username" required />
            </div>
          ) : (
            <>
              <div class="field"><label for="name">{t('Nom de la boutique')}</label><input id="name" class="input" value={form.name} onInput={set('name')} placeholder="Pagnes de Fifamè" required minLength={2} maxLength={60} /></div>
              <div class="field"><label for="city">{t('Ville')}</label><input id="city" class="input" value={form.city} onInput={set('city')} placeholder="Cotonou" required minLength={2} maxLength={40} /></div>
            </>
          )}
          <div class="field">
            <label for="pin">{t('Code PIN (4 à 6 chiffres)')}</label>
            <input id="pin" class="input" type="password" inputMode="numeric" pattern="[0-9]{4,6}" value={form.pin} onInput={set('pin')} autocomplete={mode === 'login' ? 'current-password' : 'new-password'} required />
          </div>
          {error && <ErrorBox message={error} />}
          <button class="btn primary" disabled={busy}>{mode === 'login' ? t('Se connecter') : t('Créer ma boutique')}</button>
        </form>
      </main>
    </div>
  );
}

// ================================================================ tableau de bord

interface Dash {
  shop: { name: string; slug: string; city: string; payoutLabel?: string | null; walletConnected?: boolean };
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
      setError(errorText(e, 'Erreur de chargement.'));
    }
  }, [token]);

  useEffect(() => {
    void load();
    return subscribe('/api/shops/me/events', token, () => void load());
  }, [load, token]);

  if (!data) return <div class="screen"><TopBar />{error ? <div class="content"><ErrorBox message={error} /></div> : <Loading />}</div>;
  const simulation = data.orders[0]?.simulation ?? false;

  const compact = new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 0 });
  const time = (d: string) => new Date(d).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });

  return (
    <div class="screen">
      <SimBanner show={simulation} />
      <main class="content fade-in" style="padding-top:max(14px, env(safe-area-inset-top))">
        <section class="band">
          <div class="row" style="gap:12px">
            <div class="avatar" style="width:44px;height:44px;font-size:16px" aria-hidden="true">{initials(data.shop.name)}</div>
            <div class="grow">
              <h2 style="overflow-wrap:anywhere">{data.shop.name}</h2>
              <div class="tiny" style="color:#C7CBF0;overflow-wrap:anywhere">{t('Identifiant : {slug}', { slug: data.shop.slug })}</div>
            </div>
            <LangToggle dark />
            <button class="icon-btn" aria-label={t('Se déconnecter')} title={t('Se déconnecter')} onClick={onLogout}><Logout /></button>
          </div>
          <div>
            <div class="label-on-dark">{t('Encaissé sur les commandes livrées')}</div>
            <div class="band-amount" style="margin-top:6px">{xof(data.summary.releasedXof)}</div>
          </div>
          <div class="figures">
            <div><b>{data.summary.releasedCount}</b><span>{t('livrées')}</span></div>
            <div><b style="color:var(--saffron)">{data.summary.inDeliveryCount}</b><span>{t('en livraison')}</span></div>
            <div><b>{compact.format(data.summary.lockedXof)}</b><span>{t('FCFA bloqués pour vous')}</span></div>
          </div>
        </section>

        <a class="link-row" href="/v/wallet" onClick={(e) => { e.preventDefault(); navigate('/v/wallet'); }}>
          <span class="link-icon"><Bolt size={18} color="var(--indigo)" /></span>
          <span class="grow">
            <strong style="display:block;font-size:15px">{t('Mon wallet Lightning')}</strong>
            <span class="tiny muted">{data.shop.walletConnected ? t('Branché : paiements réels') : t('Brancher mon wallet pour des paiements réels')}</span>
          </span>
          {data.shop.walletConnected && <span class="status RELEASED">{t('Branché')}</span>}
          <span class="chev"><Chevron /></span>
        </a>

        <a class="link-row" href="/v/payout" onClick={(e) => { e.preventDefault(); navigate('/v/payout'); }}>
          <span class="link-icon"><Phone size={18} color="var(--indigo)" /></span>
          <span class="grow">
            <strong style="display:block;font-size:15px">{t('Recevoir mon argent')}</strong>
            <span class="tiny muted">{data.shop.payoutLabel ? t('Sur {label}', { label: data.shop.payoutLabel }) : t('Choisir mon compte Mobile Money')}</span>
          </span>
          <span class="chev"><Chevron /></span>
        </a>

        <a class="link-row" href={`/verify/${data.shop.slug}`} target="_blank" rel="noopener">
          <span class="link-icon"><Shield size={18} color="var(--indigo)" /></span>
          <span class="grow">
            <strong style="display:block;font-size:15px">{t('Ma réputation publique')}</strong>
            <span class="tiny muted">{t('Des reçus vérifiables, à partager avec vos clients')}</span>
          </span>
          <span class="chev"><Chevron /></span>
        </a>

        <h2 class="section-title">{t('Commandes')}</h2>
        <div class="list">
          {data.orders.length === 0 && (
            <div class="list-empty">{t("Aucune commande pour l'instant. Créez-en une, puis envoyez le lien à votre client sur WhatsApp.")}</div>
          )}
          {data.orders.map((o) => (
            <a key={o.id} class="list-row" href={`/v/o/${o.id}`} onClick={(e) => { e.preventDefault(); navigate(`/v/o/${o.id}`); }}>
              <div class="grow">
                <div class="title">{o.itemLabel}</div>
                <div class="tiny muted">{time(o.createdAt)}, {o.courierAssigned ? t('livreur assigné') : t('sans livreur')}</div>
              </div>
              <div style="text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:3px">
                <span class="amount">{new Intl.NumberFormat(locale()).format(o.totalXof)}</span>
                <span class={`status ${o.state}`}>{stateLabel(o.state, o.stateLabel)}</span>
              </div>
            </a>
          ))}
        </div>
      </main>
      <footer class="bottom">
        <a class="btn primary" href="/v/new" onClick={(e) => { e.preventDefault(); navigate('/v/new'); }}><Plus /> {t('Nouvelle commande')}</a>
      </footer>
    </div>
  );
}

// ================================================================ mon wallet Lightning (NWC)

export function SellerWallet() {
  const [token] = useSellerToken();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [uri, setUri] = useState('');
  const [scanning, setScanning] = useState(false);
  const [Scanner, setScanner] = useState<typeof ScannerType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, showToast] = useToast();

  useEffect(() => {
    if (!token) { navigate('/v'); return; }
    api<{ connected: boolean }>('/api/shops/me/wallet', { token }).then((r) => setConnected(r.connected)).catch(() => setConnected(false));
  }, [token]);
  useEffect(() => {
    if (scanning && !Scanner) void import('../ui/Scanner.js').then((m) => setScanner(() => m.Scanner));
  }, [scanning]);
  if (!token) return null;

  async function connect(value: string) {
    setBusy(true);
    setError(null);
    try {
      await api('/api/shops/me/wallet', { token, body: { uri: value.trim() } });
      setConnected(true);
      setUri('');
      showToast(t('Wallet branché'));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await api('/api/shops/me/wallet/disconnect', { token, body: {} });
      setConnected(false);
      showToast(t('Wallet débranché'));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="screen">
      <TopBar back="/v" title={t('Mon wallet Lightning')} />
      <main class="content fade-in">
        {connected ? (
          <>
            <div class="card ok small">
              <strong>{t('Votre wallet est branché.')}</strong> {t("Vos nouvelles commandes utilisent de vrais paiements Lightning : la facture est créée dans votre wallet, et l'argent y arrive directement à la livraison.")}
            </div>
            <button class="btn quiet" disabled={busy} onClick={() => void disconnect()}>{t('Débrancher mon wallet')}</button>
          </>
        ) : (
          <>
            <p class="muted small">
              {t('Branchez votre propre wallet Lightning avec')} <strong>Nostr Wallet Connect</strong>. {t("Sésame pourra lui demander de créer et de régler vos factures, et de payer la course de vos livreurs. L'argent arrive dans votre wallet, jamais chez Sésame.")}
            </p>
            <ol class="small muted" style="margin:0;padding-left:20px;display:grid;gap:6px">
              <li>{t('Dans votre wallet (par exemple Alby Hub), créez une connexion pour « Sésame ».')}</li>
              <li>{t('Autorisez les factures, les factures « hold » et les paiements, avec un budget (par exemple 50 000 sats par mois) : Sésame ne pourra jamais dépenser plus.')}</li>
              <li>{t('Copiez le code qui commence par')} <span class="mono">nostr+walletconnect://</span>{t(', ou scannez son QR.')}</li>
            </ol>
            {scanning && Scanner ? (
              <Scanner onResult={(txt) => { setScanning(false); void connect(txt); }} onError={(m) => { setScanning(false); setError(m); }} />
            ) : null}
            <form class="stack" onSubmit={(e) => { e.preventDefault(); void connect(uri); }}>
              <div class="field">
                <label for="nwc">{t('Code de connexion')}</label>
                <textarea id="nwc" class="input mono" style="min-height:88px;font-size:13px" value={uri} autocomplete="off" spellcheck={false}
                  placeholder="nostr+walletconnect://…" onInput={(e) => setUri((e.target as HTMLTextAreaElement).value)} />
                <span class="hint">{t("Ce code est chiffré sur le serveur et n'est jamais affiché ni partagé.")}</span>
              </div>
              {error && <ErrorBox message={error} />}
              <button class="btn primary" disabled={busy || !uri.trim().startsWith('nostr+walletconnect://')}>{busy ? t('Vérification du wallet…') : t('Brancher mon wallet')}</button>
              <button type="button" class="btn ghost" onClick={() => setScanning(!scanning)}>{scanning ? t('Arrêter la caméra') : t('Scanner le QR de connexion')}</button>
            </form>
            <p class="tiny muted">{t('Le wallet doit gérer les factures « hold » (Alby Hub à jour, par exemple). Sans wallet branché, vos commandes restent en démonstration.')}</p>
          </>
        )}
        {connected && error && <ErrorBox message={error} />}
      </main>
      <Toast text={toast} />
    </div>
  );
}

// ================================================================ recevoir mon argent

interface PayoutView { method: 'wallet' | 'momo' | 'lightning'; operator?: string; phoneHint?: string; address?: string; label: string | null }

export function SellerPayout() {
  const [token] = useSellerToken();
  const [current, setCurrent] = useState<PayoutView | null>(null);
  const [method, setMethod] = useState<'momo' | 'lightning'>('momo');
  const [operator, setOperator] = useState<string>('MTN MoMo');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, showToast] = useToast();

  useEffect(() => {
    if (!token) { navigate('/v'); return; }
    api<PayoutView>('/api/shops/me/payout', { token }).then((p) => {
      setCurrent(p);
      if (p.method === 'lightning') { setMethod('lightning'); setAddress(p.address ?? ''); }
      if (p.method === 'momo' && p.operator) setOperator(p.operator);
    }).catch(() => undefined);
  }, [token]);
  if (!token) return null;

  async function save(e: Event) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = method === 'momo' ? { method, operator, phone } : { method, address };
      setCurrent(await api<PayoutView>('/api/shops/me/payout', { token, body }));
      setPhone('');
      showToast(t('Compte enregistré'));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const digits = phone.replace(/\D/g, '');
  const valid = method === 'momo' ? digits.length >= 8 && digits.length <= 15 : /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(address.trim());

  return (
    <div class="screen">
      <TopBar back="/v" title={t('Recevoir mon argent')} />
      <form class="content fade-in" onSubmit={save}>
        {current?.label
          ? <div class="card ok small">{t('Vos ventes sont versées sur')} <strong>{current.label}</strong>{t(', dès que la livraison est confirmée.')}</div>
          : <div class="card soft small">{t("Choisissez où recevoir l'argent de vos ventes. Il est versé dès que la livraison est confirmée.")}</div>}
        <div class="segmented" role="group" aria-label={t('Moyen de versement')}>
          <button type="button" aria-pressed={method === 'momo'} onClick={() => setMethod('momo')}>Mobile Money</button>
          <button type="button" aria-pressed={method === 'lightning'} onClick={() => setMethod('lightning')}>{t('Wallet Lightning')}</button>
        </div>
        {method === 'momo' ? (
          <>
            <div class="field">
              <span class="label" id="op">{t('Opérateur')}</span>
              <div class="operators" role="group" aria-labelledby="op">
                {MOMO_OPERATORS.map((o) => (
                  <button type="button" key={o} aria-pressed={operator === o} onClick={() => setOperator(o)}>{o}</button>
                ))}
              </div>
            </div>
            <div class="field">
              <label for="pphone">{t('Numéro Mobile Money')}</label>
              <input id="pphone" class="input" type="tel" inputMode="tel" autocomplete="tel" placeholder={current?.phoneHint ? `•• •• •• ${current.phoneHint}` : '97 00 00 00'}
                value={phone} onInput={(e) => setPhone((e.target as HTMLInputElement).value)} />
              <span class="hint">{t("Votre numéro est chiffré. Il n'est jamais montré aux clients ni aux livreurs.")}</span>
            </div>
          </>
        ) : (
          <div class="field">
            <label for="ln">{t('Adresse Lightning')}</label>
            <input id="ln" class="input" value={address} onInput={(e) => setAddress((e.target as HTMLInputElement).value)} placeholder="fifame@blink.sv" autocomplete="off" />
            <span class="hint">{t('Pour garder vos ventes en bitcoin.')}</span>
          </div>
        )}
        {error && <ErrorBox message={error} />}
        <button class="btn primary" disabled={busy || !valid}>{t('Enregistrer')}</button>
        <p class="tiny muted">{t("En arrière-plan, le paiement passe par le réseau Bitcoin Lightning et un partenaire de change agréé convertit en FCFA. Pendant la livraison, personne ne peut prendre l'argent bloqué, pas même Sésame.")}</p>
      </form>
      <Toast text={toast} />
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
      const labels: Record<string, string> = { itemLabel: t("l'article"), amountXof: t('le prix'), deliveryFeeXof: t('les frais de livraison') };
      setAiNote(r.missingFields.length
        ? t('À compléter : {fields}. Vérifiez avant de créer.', { fields: r.missingFields.map((f) => labels[f]).join(', ') })
        : t('Champs remplis automatiquement. Vérifiez-les avant de créer la commande.'));
    } catch (e) {
      setAiNote(errorText(e, 'Extraction impossible, remplissez le formulaire.'));
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
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <div class="screen">
      <TopBar back="/v" title={t('Nouvelle commande')} />
      <form class="content fade-in" onSubmit={create}>
        <section class="ai-box">
          <div class="row" style="gap:8px">
            <Sparkle color="var(--indigo)" /><h3 style="color:var(--indigo-ink)">{t('Remplir depuis la conversation')}</h3>
          </div>
          <label class="hint" for="chat">{t('Collez les messages WhatsApp du client. Les numéros de téléphone sont masqués automatiquement.')}</label>
          <textarea id="chat" class="input" value={chat} maxLength={4000} onInput={(e) => setChat((e.target as HTMLTextAreaElement).value)}
            placeholder={t('Je prends les 2 pagnes bleus à 18 000, livraison à Fidjrossè 1 500')} />
          <button type="button" class="btn ghost" disabled={busy || chat.trim().length < 5} onClick={fill}>{t('Remplir automatiquement')}</button>
          {aiNote && <div class="hint" role="status">{aiNote}</div>}
        </section>

        <div class="field">
          <label for="item">{t('Article')}</label>
          <input id="item" class="input" value={form.itemLabel} maxLength={120} required onInput={(e) => setForm({ ...form, itemLabel: (e.target as HTMLInputElement).value })} />
        </div>
        <div class="row" style="gap:10px;align-items:flex-start">
          <div class="field" style="flex:1"><label for="price">{t('Prix (FCFA)')}</label>
            <input id="price" class="input" inputMode="numeric" required value={form.itemXof} onInput={(e) => setForm({ ...form, itemXof: (e.target as HTMLInputElement).value })} /></div>
          <div class="field" style="flex:1"><label for="deliv">{t('Livraison (FCFA)')}</label>
            <input id="deliv" class="input" inputMode="numeric" value={form.deliveryFeeXof} onInput={(e) => setForm({ ...form, deliveryFeeXof: (e.target as HTMLInputElement).value })} /></div>
        </div>
        <div class="field">
          <span class="label" id="delai">{t('Délai de livraison')}</span>
          <div class="segmented" role="group" aria-labelledby="delai">
            {[2, 6, 12].map((h) => (
              <button type="button" key={h} aria-pressed={form.deliveryHours === h} onClick={() => setForm({ ...form, deliveryHours: h })}>{h} h</button>
            ))}
          </div>
        </div>
        {item > 0 && (
          <section class="card stack small" style="gap:8px">
            <div class="between"><span class="muted">{t('Le client paie')}</span><strong>{xof(item + delivery)}</strong></div>
            {delivery > 0 && <div class="between"><span class="muted">{t('Part du livreur')}</span><span>− {xof(delivery)}</span></div>}
            <div class="between"><span class="muted">{t('Frais Sésame (1 %, seulement si livré)')}</span><span>− {xof(fee)}</span></div>
            <div class="divider" />
            <div class="between"><span style="font-weight:700">{t('Vous recevez')}</span><strong class="big-amount" style="color:var(--leaf)">{xof(item - fee)}</strong></div>
          </section>
        )}
        {error && <ErrorBox message={error} />}
        <button class="btn success" disabled={busy || !form.itemLabel || item <= 0}>{t('Créer la commande')}</button>
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
      setError(errorText(e, 'Erreur de chargement.'));
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
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }

  const clientMsg = clientLink ? clientMessage(order, clientLink) : '';
  const courierMsg = courierLink ? courierMessage(order, courierLink) : '';
  const copy = async (text: string) => showToast((await copyText(text)) ? t('Message copié') : t('Copie impossible'));

  return (
    <div class="screen">
      <SimBanner show={order.simulation} />
      <TopBar back="/v" subtitle={t('Commande n° {n}', { n: order.id.slice(0, 4).toUpperCase() })} title={order.itemLabel}
        right={<span class={`pill ${order.state}`}>{stateLabel(order.state, order.stateLabel)}</span>} />
      <main class="content fade-in">
        <section class="card stack small" style="gap:6px">
          <div class="between"><span class="muted">{t('Le client paie')}</span><strong>{xof(order.totalXof)}</strong></div>
          <div class="between"><span class="muted">{t('Frais Sésame')}</span><span>− {xof(order.feeXof ?? 0)}</span></div>
          {order.courierAssigned && <div class="between"><span class="muted">{t('Livreur ({address})', { address: order.courierAddress ?? '' })}</span><span>− {xof(order.deliveryFeeXof)}</span></div>}
          <div class="divider" />
          <div class="between"><span style="font-weight:700">{t('Vous recevez à la livraison')}</span><strong class="big-amount" style="color:var(--leaf)">{xof(order.netXof ?? 0)}</strong></div>
          <div class="tiny muted">{order.sellerPayoutLabel ? t('Versé sur votre {label}', { label: order.sellerPayoutLabel }) : t('Reçu dans votre wallet Lightning')}{order.payment?.method === 'momo' ? t('. Le client a payé avec {op}.', { op: order.payment.operator ?? '' }) : order.payment?.method === 'lightning' ? t('. Le client a payé avec un wallet Lightning.') : '.'}</div>
        </section>

        {clientLink && (order.state === 'DRAFT' || order.state === 'AWAITING_PAYMENT') && (
          <section class="card stack">
            <h3>{t('Envoyez le lien de paiement au client')}</h3>
            <MessagePreview text={clientMsg} />
            <a class="btn success" href={whatsappUrl(clientMsg)} target="_blank" rel="noopener noreferrer"><WhatsApp /> {t('Envoyer sur WhatsApp')}</a>
            <button class="btn ghost" onClick={() => void copy(clientMsg)}>{t('Copier le message')}</button>
          </section>
        )}

        {order.state === 'FUNDS_LOCKED' && (
          <section class="card stack">
            <h3>{t('Paiement sécurisé. Confiez le colis à un livreur.')}</h3>
            <div class="field">
              <label for="ln">{t('Adresse Lightning du livreur (pour lui verser sa course)')}</label>
              <input id="ln" class="input" value={address} onInput={(e) => setAddress((e.target as HTMLInputElement).value)} placeholder="moussa@walletofsatoshi.com" autocomplete="off" />
            </div>
            <button class="btn primary" disabled={busy || address.length < 5} onClick={() => act(async () => {
              const r = await api<{ courierToken: string }>(`/api/orders/${id}/assign`, { token, body: { lightningAddress: address } });
              local.set(courierTokKey(id), r.courierToken);
            })}>{t('Assigner le livreur')}</button>
            <div class="hint">{t('Le client peut aussi confirmer lui-même la réception, sans livreur.')}</div>
          </section>
        )}

        {courierLink && order.state === 'OUT_FOR_DELIVERY' && (
          <section class="card stack">
            <h3>{t('Envoyez sa mission au livreur')}</h3>
            <MessagePreview text={courierMsg} />
            <a class="btn success" href={whatsappUrl(courierMsg)} target="_blank" rel="noopener noreferrer"><WhatsApp /> {t('Envoyer au livreur')}</a>
            <button class="btn ghost" onClick={() => void copy(courierMsg)}>{t('Copier le message')}</button>
          </section>
        )}

        {order.state === 'RELEASED' && <div class="card ok small">{t('Livrée et payée')}{order.sellerPayoutLabel ? t(', versé sur votre {label}', { label: order.sellerPayoutLabel }) : ''}. {t('Le livreur et les frais ont été réglés automatiquement.')}</div>}
        {order.state === 'REFUNDED' && <div class="card danger small">{t('Remboursée : le client a récupéré son argent.')}</div>}

        {active && (confirmCancel ? (
          <section class="card warn stack small">
            <strong>{t('Annuler la commande ?')}</strong>
            <span>{t('Le client sera remboursé immédiatement. Cette action est définitive.')}</span>
            <button class="btn dark" disabled={busy} onClick={() => act(() => api(`/api/orders/${id}/cancel`, { token, body: {} }))}>{t('Oui, annuler et rembourser')}</button>
            <button class="btn ghost" onClick={() => setConfirmCancel(false)}>{t('Non')}</button>
          </section>
        ) : (
          <button class="btn quiet" onClick={() => setConfirmCancel(true)}>{t('Annuler la commande et rembourser le client')}</button>
        ))}
        {error && <ErrorBox message={error} />}
      </main>
      <Toast text={toast} />
    </div>
  );
}

/** Aperçu du message tel qu'il apparaîtra dans WhatsApp (*gras* rendu, lien raccourci). */
function MessagePreview({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div class="chat message-preview" aria-label={t('Aperçu du message')}>
      <div class="bubble mine">
        {lines.map((line, i) => {
          if (/^https?:\/\//.test(line)) return <div key={i} class="msg-link">{line.replace(/#.*$/, '').replace(/^https?:\/\//, '')}…</div>;
          if (!line) return <div key={i} style="height:8px" />;
          const parts = line.split(/(\*[^*]+\*)/g);
          return <div key={i}>{parts.map((p, j) => (p.startsWith('*') && p.endsWith('*') && p.length > 2 ? <strong key={j}>{p.slice(1, -1)}</strong> : p))}</div>;
        })}
      </div>
    </div>
  );
}

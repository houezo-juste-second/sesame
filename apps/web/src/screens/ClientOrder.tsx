/**
 * Parcours client (/c/:id#t=…) : commande → paiement → sésame → confirmation.
 * Le sésame P est généré ICI, sur le téléphone, et n'est envoyé qu'à la libération.
 */
import { useCallback, useEffect, useState } from 'preact/hooks';
import { encodeSesameQr, generateSesame, hashPreimage } from '@sesame/core';
import { api, ApiError, clock, initials, linkToken, local, MOMO_OPERATORS, sats, subscribe, timeLeft, xof, type OrderView } from '../api.js';
import { Check, Clock, Eye, Key, Lock, Phone, Shield } from '../ui/icons.js';
import { Brand, copyText, ErrorBox, LangToggle, Loading, Qr, SimBanner, Toast, TopBar, useNow, useToast } from '../ui/kit.js';
import { errorText, stateLabel, t } from '../i18n.js';
import { isRealDemo } from '../demo.js';

const pKey = (id: string) => `sesame:p:${id}`;

export function ClientOrder({ id }: { id: string }) {
  const [token] = useState(() => linkToken('c', id));
  const [order, setOrder] = useState<OrderView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
    void load();
    if (!token) return;
    return subscribe(`/api/orders/${id}/events`, token, () => void load());
  }, [load, id, token]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div class="screen"><TopBar /><div class="content">
        <ErrorBox message={t('Ce lien est incomplet. Demandez à la vendeuse de vous renvoyer le lien de la commande.')} />
      </div></div>
    );
  }
  if (!order) return <div class="screen"><TopBar />{error ? <div class="content"><ErrorBox message={error} /></div> : <Loading />}</div>;

  const preimage = local.get(pKey(id));

  const pay = () => act(async () => {
    // Réutilise le sésame déjà généré sur ce téléphone, sinon en crée un.
    const existing = local.get(pKey(id));
    let hash: string;
    if (existing) {
      hash = hashPreimage(existing);
    } else {
      const s = generateSesame();
      local.set(pKey(id), s.preimage);
      if (local.get(pKey(id)) !== s.preimage) {
        throw new ApiError(0, 'NO_STORAGE', t("Ce navigateur ne peut pas conserver votre sésame (navigation privée ?). Ouvrez le lien dans un navigateur normal."));
      }
      hash = s.paymentHash;
    }
    await api(`/api/orders/${id}/lock`, { token, body: { paymentHash: hash } });
  });

  const view = (() => {
    switch (order.state) {
      case 'DRAFT': return <OrderScreen order={order} busy={busy} onPay={pay} />;
      case 'AWAITING_PAYMENT':
        return <PayScreen order={order} busy={busy} onDemoPay={() => act(() => api(`/api/demo/pay/${id}`, { token, body: {} }))}
          onMomoPay={(operator, phone) => act(() => api(`/api/orders/${id}/pay/momo`, { token, body: { operator, phone } }))}
          onCopy={async () => showToast((await copyText(order.bolt11 ?? '')) ? t('Facture copiée') : t('Copie impossible'))} />;
      case 'FUNDS_LOCKED':
      case 'OUT_FOR_DELIVERY':
        return <SesameScreen order={order} preimage={preimage} busy={busy}
          onReceived={() => act(() => api(`/api/orders/${id}/release`, { token, body: { preimage } }))}
          onCopy={async () => showToast((await copyText(encodeSesameQr(id, preimage ?? ''))) ? t('Sésame copié') : t('Copie impossible'))} />;
      default: return <DoneScreen order={order} />;
    }
  })();

  return (
    <div class="screen">
      <SimBanner show={order.simulation} />
      {view}
      {error && <div style="padding:0 20px 12px"><ErrorBox message={error} /></div>}
      <Toast text={toast} />
    </div>
  );
}

function ShopHeader({ order }: { order: OrderView }) {
  const rep = order.reputation ?? { released: 0, refunded: 0 };
  return (
    <section class="row" style="gap:12px">
      <div class="avatar" aria-hidden="true">{initials(order.shopName)}</div>
      <div class="grow">
        <h2>{order.shopName}</h2>
        <div class="small muted">
          {order.shopCity}, {rep.released === 0 ? t('nouvelle sur Sésame') : t(rep.released > 1 ? '{n} livraisons prouvées' : '{n} livraison prouvée', { n: rep.released })}
        </div>
      </div>
      <a class="chip-link" href={`/verify/${order.shopSlug}`} target="_blank" rel="noopener">{t('Vérifier')}</a>
    </section>
  );
}

function OrderScreen({ order, busy, onPay }: { order: OrderView; busy: boolean; onPay: () => void }) {
  return (
    <>
      <header class="top"><Brand /><span class="grow" /><LangToggle /></header>
      <main class="content fade-in" style="gap:20px">
        <ShopHeader order={order} />
        <section class="ticket" aria-label={t('Votre commande')}>
          <div class="ticket-part stack" style="gap:8px">
            <span class="tiny muted">{t('Votre commande')}</span>
            <h2 style="font-size:20px">{order.itemLabel}</h2>
            <div class="between small" style="margin-top:6px"><span class="muted">{t('Article')}</span><span>{xof(order.itemXof)}</span></div>
            <div class="between small"><span class="muted">{t('Livraison')}</span><span>{xof(order.deliveryFeeXof)}</span></div>
          </div>
          <div class="ticket-tear" aria-hidden="true" />
          <div class="ticket-part between" style="align-items:flex-end">
            <span style="font-weight:700">Total</span>
            <span><span class="ticket-total">{xof(order.totalXof)}</span><br /><span class="tiny muted">{t('soit {sats}', { sats: sats(order.amountSat) })}</span></span>
          </div>
        </section>
        <section class="trust">
          <span class="trust-icon"><Shield size={17} /></span>
          <div>
            <h3>{t("Votre argent reste bloqué jusqu'à la livraison")}</h3>
            <p class="small muted" style="margin-top:3px">
              {t('Personne ne peut le prendre avant. Sans livraison dans les {h} h suivant le paiement, vous êtes remboursé automatiquement.', { h: order.deliveryHours })}
            </p>
          </div>
        </section>
      </main>
      <footer class="bottom">
        <button class="btn primary" disabled={busy} onClick={onPay}><Lock /> {t('Payer {amount}', { amount: xof(order.totalXof) })}</button>
        <div class="tiny muted center">{t('En Mobile Money (MTN, Moov, Wave, Orange…) ou avec un wallet Lightning')}</div>
      </footer>
    </>
  );
}

function PayScreen({ order, busy, onDemoPay, onMomoPay, onCopy }: {
  order: OrderView; busy: boolean; onDemoPay: () => void; onMomoPay: (operator: string, phone: string) => void; onCopy: () => void;
}) {
  const [method, setMethod] = useState<'momo' | 'lightning'>(order.realWallet ? 'lightning' : 'momo');
  return (
    <>
      <TopBar subtitle={order.shopName} title={t('Payer {amount}', { amount: xof(order.totalXof) })} />
      <main class="content fade-in">
        <div class="segmented" role="group" aria-label={t('Moyen de paiement')}>
          <button type="button" aria-pressed={method === 'momo'} onClick={() => setMethod('momo')}>Mobile Money</button>
          <button type="button" aria-pressed={method === 'lightning'} onClick={() => setMethod('lightning')}>{t('Wallet Lightning')}</button>
        </div>
        {order.realWallet && (
          <div class="card ok small"><strong>{t('Paiement Lightning réel.')}</strong> {t("La facture vient du wallet de la vendeuse ; votre argent reste bloqué jusqu'à la livraison.")}</div>
        )}
        {method === 'momo' && order.realWallet
          ? <div class="card soft small">{t('Le paiement Mobile Money pour cette boutique arrive bientôt, avec notre partenaire de change. Payez avec votre wallet Lightning en attendant.')}</div>
          : method === 'momo'
          ? <MomoPay order={order} busy={busy} onPay={onMomoPay} />
          : <LightningPay order={order} busy={busy} onDemoPay={onDemoPay} onCopy={onCopy} />}
      </main>
    </>
  );
}

function MomoPay({ order, busy, onPay }: { order: OrderView; busy: boolean; onPay: (operator: string, phone: string) => void }) {
  const [operator, setOperator] = useState<string>('MTN MoMo');
  const [phone, setPhone] = useState('');
  const [sent, setSent] = useState(false);
  const digits = phone.replace(/\D/g, '');
  const valid = digits.length >= 8 && digits.length <= 15;

  if (sent) {
    return (
      <section class="card stack" style="align-items:center;text-align:center;gap:12px">
        <span class="trust-icon" style="width:52px;height:52px"><Phone size={24} color="#fff" /></span>
        <h2>{t('Validez sur votre téléphone')}</h2>
        <p class="small muted">
          {t('Une demande de paiement de {amount} a été envoyée à votre compte {op} se terminant par {d}. Confirmez-la avec votre code secret.', { amount: xof(order.totalXof), op: operator, d: digits.slice(-2) })}
        </p>
        {order.simulation && (
          <button class="btn saffron" disabled={busy} onClick={() => onPay(operator, phone)}>{t("J'ai validé sur mon téléphone (simulation)")}</button>
        )}
        <button class="btn quiet" onClick={() => setSent(false)}>{t('Changer de numéro')}</button>
      </section>
    );
  }
  return (
    <form class="stack" style="gap:14px" onSubmit={(e) => { e.preventDefault(); if (valid) setSent(true); }}>
      <div class="field">
        <span class="label" id="op">{t('Votre opérateur')}</span>
        <div class="operators" role="group" aria-labelledby="op">
          {MOMO_OPERATORS.map((o) => (
            <button type="button" key={o} aria-pressed={operator === o} onClick={() => setOperator(o)}>{o}</button>
          ))}
        </div>
      </div>
      <div class="field">
        <label for="phone">{t('Numéro Mobile Money')}</label>
        <input id="phone" class="input" type="tel" inputMode="tel" autocomplete="tel" placeholder="97 00 00 00" value={phone}
          onInput={(e) => setPhone((e.target as HTMLInputElement).value)} required />
      </div>
      <div class="trust">
        <span class="trust-icon"><Shield size={17} /></span>
        <p class="small muted">{t("L'argent reste bloqué jusqu'à la livraison. Sans livraison, il revient sur ce même compte {op}.", { op: operator })}</p>
      </div>
      <button class="btn primary" disabled={busy || !valid}>{t('Payer {amount} avec {op}', { amount: xof(order.totalXof), op: operator })}</button>
    </form>
  );
}

function LightningPay({ order, busy, onDemoPay, onCopy }: { order: OrderView; busy: boolean; onDemoPay: () => void; onCopy: () => void }) {
  const now = useNow(15_000);
  const invoice = order.bolt11 ?? '';
  return (
    <>
      <section class="card stack" style="align-items:center;text-align:center">
        <div class="qr-box large"><Qr text={`lightning:${invoice.toUpperCase()}`} label={t('QR de paiement Lightning')} /></div>
        <div class="big-amount" style="font-size:20px">{sats(order.amountSat)}</div>
        <div class="small muted">{t('Scannez avec votre wallet (Wallet of Satoshi, Phoenix, Blink…). La facture expire dans {left}.', { left: timeLeft(order.invoiceExpiresAt, now) })}</div>
      </section>
      <a class="btn primary" href={`lightning:${invoice}`}>{t('Ouvrir mon wallet')}</a>
      <button class="btn ghost" onClick={onCopy}>{t('Copier la facture')}</button>
      {order.simulation && (
        <button class="btn saffron" disabled={busy} onClick={onDemoPay}>{t('Payer avec le wallet de démo')}</button>
      )}
      {!order.simulation && isRealDemo(order.id) && (
        <button class="btn saffron" disabled={busy} onClick={onDemoPay}>{t('Payer avec le wallet de test de la cliente')}</button>
      )}
      <div class="tiny muted center">{t('Après le paiement, cette page se met à jour toute seule.')}</div>
    </>
  );
}

function SesameScreen({ order, preimage, busy, onReceived, onCopy }: {
  order: OrderView; preimage: string | null; busy: boolean; onReceived: () => void; onCopy: () => void;
}) {
  const now = useNow();
  const [shown, setShown] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const enRoute = order.state === 'OUT_FOR_DELIVERY';
  return (
    <>
      <TopBar subtitle={`${order.shopName}, ${xof(order.totalXof)}`} title={order.itemLabel} />
      <main class="content fade-in">
        <section class="card ok row" style="gap:12px">
          <span class="check-circle"><Check /></span>
          <div>
            <h3>{t('Paiement sécurisé')}</h3>
            <div class="small">{enRoute ? t('Votre colis est en route.') : t('Votre argent est bloqué. La vendeuse prépare le colis.')}</div>
            {order.payment?.method === 'momo' && <div class="tiny">{t('Payé avec {op} •• {d}', { op: order.payment.operator ?? '', d: order.payment.phoneHint ?? '' })}</div>}
          </div>
        </section>

        {preimage ? (
          <section class="ticket sesame" aria-label={t('Mon sésame')}>
            <div class="ticket-part stack" style="align-items:center;gap:14px">
              <div class="row" style="align-self:stretch">
                <span class="veil-icon" style="width:34px;height:34px"><Key size={17} color="#F3AA3C" /></span>
                <h2 class="grow">{t('Mon sésame')}</h2>
                <span class="sesame-code">n° {order.id.slice(0, 4).toUpperCase()}</span>
              </div>
              <div class="qr-box">
                <Qr text={encodeSesameQr(order.id, preimage)} label={t('QR de votre sésame')} />
                {!shown && (
                  <div class="qr-veil">
                    <span class="veil-icon"><Eye color="#F3AA3C" /></span>
                    <strong class="small">{t('Sésame masqué')}</strong>
                    <span class="tiny">{t('À afficher seulement devant le livreur')}</span>
                  </div>
                )}
              </div>
              <button class="btn ink" aria-pressed={shown} onClick={() => setShown(!shown)}>
                {shown ? t('Masquer mon sésame') : t('Afficher mon sésame')}
              </button>
            </div>
            <div class="ticket-tear" aria-hidden="true" />
            <div class="ticket-part stack" style="gap:10px;padding-top:6px">
              <p class="small center" style="line-height:1.5">
                {t('Montrez-le')} <strong>{t('seulement après avoir vérifié votre colis')}</strong>. {t('Le livreur le scanne et la vendeuse est payée.')}
              </p>
              <button class="btn quiet" style="color:var(--saffron-ink)" onClick={onCopy}>{t('Copier mon sésame (sauvegarde)')}</button>
            </div>
          </section>
        ) : (
          <div class="card warn small" role="note">
            {t('Ce téléphone ne contient pas le sésame de cette commande. Sans sésame, la livraison ne peut pas être confirmée :')}{' '}
            <strong>{t('vous serez remboursé automatiquement')}</strong> {t("à l'échéance.")}
          </div>
        )}

        <section class="row" style="gap:12px;padding:2px 4px">
          <Clock color="var(--muted)" />
          <div class="grow">
            <h3>{t('Livraison attendue avant {time}', { time: clock(order.releaseDeadlineAt) })}</h3>
            <div class="small muted">{t('Sinon, remboursement automatique dans {left}', { left: timeLeft(order.releaseDeadlineAt, now) })}</div>
          </div>
        </section>
      </main>
      {preimage && (
        <footer class="bottom clear">
          {confirming ? (
            <>
              <div class="small center">{t('Vous confirmez avoir')} <strong>{t('reçu et vérifié')}</strong> {t('votre colis ? La vendeuse sera payée.')}</div>
              <button class="btn success" disabled={busy} onClick={onReceived}>{t("Oui, j'ai reçu mon colis")}</button>
              <button class="btn ghost" onClick={() => setConfirming(false)}>{t('Annuler')}</button>
            </>
          ) : (
            <>
              <button class="btn outline" onClick={() => setConfirming(true)}>{t("J'ai reçu mon colis")}</button>
              <div class="tiny muted center">{t('Si le livreur ne peut pas scanner votre sésame')}</div>
            </>
          )}
        </footer>
      )}
    </>
  );
}

function DoneScreen({ order }: { order: OrderView }) {
  const content = {
    RELEASED: { title: t('Livraison confirmée'), text: t('Merci ! {shop} a été payée. Bonne utilisation de votre achat.', { shop: order.shopName }), ok: true },
    REFUNDED: {
      title: t('Vous avez été remboursé'),
      text: order.payment?.method === 'momo'
        ? t("La livraison n'a pas été confirmée à temps : la totalité du paiement revient sur votre {op} •• {d}.", { op: order.payment.operator ?? '', d: order.payment.phoneHint ?? '' })
        : t("La livraison n'a pas été confirmée à temps : votre wallet a récupéré la totalité du paiement."),
      ok: false,
    },
    EXPIRED: { title: t('Commande expirée'), text: t("La facture n'a pas été payée à temps. Aucun argent n'a été prélevé."), ok: false },
  }[order.state as 'RELEASED' | 'REFUNDED' | 'EXPIRED'] ?? { title: stateLabel(order.state, order.stateLabel), text: '', ok: false };
  return (
    <>
      <header class="top"><Brand /><span class="grow" /><LangToggle /></header>
      <main class="content center fade-in" style="justify-content:safe center;gap:18px">
        <div class="success-burst" style={content.ok ? '' : 'background:var(--indigo-soft)'}>
          <div style={content.ok ? '' : 'background:var(--indigo)'}>{content.ok ? <Check size={38} /> : <Shield size={34} />}</div>
        </div>
        <h1>{content.title}</h1>
        <p class="muted" style="margin:0;line-height:1.5">{content.text}</p>
        <div class="card stack small" style="text-align:left;align-self:stretch">
          <div class="between"><span class="muted">{t('Commande')}</span><span>{order.itemLabel}</span></div>
          <div class="between"><span class="muted">{t('Montant')}</span><span>{xof(order.totalXof)}</span></div>
          <div class="between"><span class="muted">{t('Boutique')}</span><span>{order.shopName}</span></div>
        </div>
      </main>
    </>
  );
}

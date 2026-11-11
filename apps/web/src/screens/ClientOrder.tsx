/**
 * Parcours client (/c/:id#t=…) : commande → paiement → sésame → confirmation.
 * Le sésame P est généré ICI, sur le téléphone, et n'est envoyé qu'à la libération.
 */
import { useCallback, useEffect, useState } from 'preact/hooks';
import { encodeSesameQr, generateSesame, hashPreimage } from '@sesame/core';
import { api, ApiError, clock, initials, linkToken, local, sats, subscribe, timeLeft, xof, type OrderView } from '../api.js';
import { Check, Clock, Eye, Key, Lock, Shield } from '../ui/icons.js';
import { Brand, copyText, ErrorBox, Loading, Qr, SimBanner, Toast, TopBar, useNow, useToast } from '../ui/kit.js';

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
      setError(e instanceof ApiError ? e.message : 'Erreur de chargement.');
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
      setError(e instanceof ApiError ? e.message : 'Une erreur est survenue.');
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div class="screen"><TopBar /><div class="content">
        <ErrorBox message="Ce lien est incomplet. Demandez à la vendeuse de vous renvoyer le lien de la commande." />
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
        throw new ApiError(0, 'NO_STORAGE', "Ce navigateur ne peut pas conserver votre sésame (navigation privée ?). Ouvrez le lien dans un navigateur normal.");
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
          onCopy={async () => showToast((await copyText(order.bolt11 ?? '')) ? 'Facture copiée' : 'Copie impossible')} />;
      case 'FUNDS_LOCKED':
      case 'OUT_FOR_DELIVERY':
        return <SesameScreen order={order} preimage={preimage} busy={busy}
          onReceived={() => act(() => api(`/api/orders/${id}/release`, { token, body: { preimage } }))}
          onCopy={async () => showToast((await copyText(encodeSesameQr(id, preimage ?? ''))) ? 'Sésame copié' : 'Copie impossible')} />;
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
  return (
    <section class="row">
      <div class="avatar" aria-hidden="true">{initials(order.shopName)}</div>
      <div class="grow">
        <h2>{order.shopName}</h2>
        <div class="small muted">{order.shopCity} · vendeuse sur Sésame</div>
      </div>
    </section>
  );
}

function OrderScreen({ order, busy, onPay }: { order: OrderView; busy: boolean; onPay: () => void }) {
  const rep = order.reputation ?? { released: 0, refunded: 0 };
  return (
    <>
      <header class="top"><Brand /></header>
      <main class="content fade-in">
        <ShopHeader order={order} />
        <div class="row" style="gap:8px">
          <div class="stat"><b style="color:var(--green)">{rep.released}</b><span class="tiny muted">livraisons réussies</span></div>
          <div class="stat"><b>{rep.refunded}</b><span class="tiny muted">remboursements</span></div>
        </div>
        <section class="card stack">
          <h2 style="font-size:16px;line-height:1.3">{order.itemLabel}</h2>
          <div class="between small"><span class="muted">Article</span><span>{xof(order.itemXof)}</span></div>
          <div class="between small"><span class="muted">Livraison</span><span>{xof(order.deliveryFeeXof)}</span></div>
          <div class="divider" />
          <div class="between">
            <span style="font-weight:600">Total</span>
            <span style="text-align:right"><span class="big-amount">{xof(order.totalXof)}</span><br /><span class="tiny muted">≈ {sats(order.amountSat)}</span></span>
          </div>
        </section>
        <section class="card soft row" style="align-items:flex-start;gap:12px">
          <span class="brand-mark" style="width:36px;height:36px;border-radius:10px"><Shield /></span>
          <div>
            <div style="font-weight:600;font-size:14px;color:var(--indigo-ink)">Votre argent est bloqué jusqu'à la livraison.</div>
            <div class="small" style="color:#3F3D73;margin-top:3px;line-height:1.45">
              Sans livraison dans les {order.deliveryHours} h suivant le paiement, vous êtes remboursé automatiquement. Personne ne peut le prendre avant.
            </div>
          </div>
        </section>
      </main>
      <footer class="bottom">
        <button class="btn primary" disabled={busy} onClick={onPay}><Lock /> Payer {xof(order.totalXof)} en sécurité</button>
        <div class="tiny muted center">Avec n'importe quel wallet Lightning</div>
      </footer>
    </>
  );
}

function PayScreen({ order, busy, onDemoPay, onCopy }: { order: OrderView; busy: boolean; onDemoPay: () => void; onCopy: () => void }) {
  const now = useNow(15_000);
  const invoice = order.bolt11 ?? '';
  return (
    <>
      <TopBar subtitle={order.shopName} title={`Payer ${xof(order.totalXof)}`} />
      <main class="content fade-in">
        <section class="card stack" style="align-items:center;text-align:center">
          <div class="qr-box" style="width:260px;height:260px"><Qr text={`lightning:${invoice.toUpperCase()}`} label="QR de paiement Lightning" /></div>
          <div class="big-amount" style="font-size:20px">{sats(order.amountSat)}</div>
          <div class="small muted">Scannez avec votre wallet (Wallet of Satoshi, Phoenix, Blink…). La facture expire dans {timeLeft(order.invoiceExpiresAt, now)}.</div>
        </section>
        <a class="btn primary" href={`lightning:${invoice}`}>Ouvrir mon wallet</a>
        <button class="btn ghost" onClick={onCopy}>Copier la facture</button>
        {order.simulation && (
          <button class="btn saffron" disabled={busy} onClick={onDemoPay}>Payer avec le wallet de démo</button>
        )}
        <div class="tiny muted center">Après le paiement, cette page se met à jour toute seule.</div>
      </main>
    </>
  );
}

function SesameScreen({ order, preimage, busy, onReceived, onCopy }: {
  order: OrderView; preimage: string | null; busy: boolean; onReceived: () => void; onCopy: () => void;
}) {
  const now = useNow();
  const [shown, setShown] = useState(false);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <TopBar subtitle={order.shopName} title={`${order.itemLabel.slice(0, 28)} · ${xof(order.totalXof)}`} />
      <main class="content fade-in">
        <section class="card ok row">
          <span class="check-circle"><Check /></span>
          <div>
            <div style="font-weight:600;font-size:14px;color:var(--green-ink)">Paiement sécurisé</div>
            <div class="tiny" style="color:#2F6B45">{order.state === 'OUT_FOR_DELIVERY' ? 'Votre colis est en route.' : 'Votre argent est bloqué. La vendeuse prépare le colis.'}</div>
          </div>
        </section>

        {preimage ? (
          <section class="card deep stack" style="align-items:center;gap:14px">
            <div class="row" style="align-self:stretch;gap:8px">
              <Key /><h2 style="font-size:16px">Mon sésame</h2>
              <span class="tiny" style="margin-left:auto;color:#C9C7F2">n° {order.id.slice(0, 4).toUpperCase()}</span>
            </div>
            <div class="qr-box">
              <Qr text={encodeSesameQr(order.id, preimage)} label="QR de votre sésame" />
              {!shown && (
                <div class="qr-veil">
                  <span class="brand-mark" style="width:44px;height:44px;border-radius:50%;background:var(--indigo-deep)"><Eye /></span>
                  <strong class="small">Sésame masqué</strong>
                  <span class="tiny muted">À afficher seulement devant le livreur</span>
                </div>
              )}
            </div>
            <button class="btn saffron" style="height:48px" aria-pressed={shown} onClick={() => setShown(!shown)}>
              {shown ? 'Masquer mon sésame' : 'Afficher mon sésame'}
            </button>
            <div class="small center" style="color:#DCDAF7;line-height:1.5;max-width:300px">
              Ne le montrez <strong style="color:#fff">qu'après avoir vérifié votre colis</strong>. Le livreur le scanne, et la vendeuse est payée.
            </div>
            <button class="btn ghost" style="color:#fff;height:44px" onClick={onCopy}>Copier mon sésame (sauvegarde)</button>
          </section>
        ) : (
          <div class="card warn small" role="note">
            Ce téléphone ne contient pas le sésame de cette commande. Sans sésame, la livraison ne peut pas être confirmée :
            vous serez <strong>remboursé automatiquement</strong> à l'échéance.
          </div>
        )}

        <section class="card row" style="gap:12px">
          <Clock />
          <div class="grow">
            <div style="font-weight:600;font-size:14px">Livraison attendue avant {clock(order.releaseDeadlineAt)}</div>
            <div class="tiny muted">Sinon : remboursement automatique dans {timeLeft(order.releaseDeadlineAt, now)}</div>
          </div>
        </section>
      </main>
      {preimage && (
        <footer class="bottom clear">
          {confirming ? (
            <>
              <div class="small center">Vous confirmez avoir <strong>reçu et vérifié</strong> votre colis ? La vendeuse sera payée.</div>
              <button class="btn success" disabled={busy} onClick={onReceived}>Oui, j'ai reçu mon colis</button>
              <button class="btn ghost" onClick={() => setConfirming(false)}>Annuler</button>
            </>
          ) : (
            <>
              <button class="btn outline" onClick={() => setConfirming(true)}>J'ai reçu mon colis</button>
              <div class="tiny muted center">À utiliser si le livreur ne peut pas scanner</div>
            </>
          )}
        </footer>
      )}
    </>
  );
}

function DoneScreen({ order }: { order: OrderView }) {
  const content = {
    RELEASED: { title: 'Livraison confirmée', text: `Merci ! ${order.shopName} a été payée. Bonne utilisation de votre achat.`, ok: true },
    REFUNDED: { title: 'Vous avez été remboursé', text: "La livraison n'a pas été confirmée à temps : votre wallet a récupéré la totalité du paiement.", ok: false },
    EXPIRED: { title: 'Commande expirée', text: "La facture n'a pas été payée à temps. Aucun argent n'a été prélevé.", ok: false },
  }[order.state as 'RELEASED' | 'REFUNDED' | 'EXPIRED'] ?? { title: order.stateLabel, text: '', ok: false };
  return (
    <>
      <header class="top"><Brand /></header>
      <main class="content center fade-in" style="justify-content:center;gap:18px">
        <div class="success-burst" style={content.ok ? '' : 'background:var(--indigo-soft)'}>
          <div style={content.ok ? '' : 'background:var(--indigo)'}>{content.ok ? <Check size={38} /> : <Shield size={34} />}</div>
        </div>
        <h1>{content.title}</h1>
        <p class="muted" style="margin:0;line-height:1.5">{content.text}</p>
        <div class="card stack small" style="text-align:left">
          <div class="between"><span class="muted">Commande</span><span>{order.itemLabel}</span></div>
          <div class="between"><span class="muted">Montant</span><span>{xof(order.totalXof)}</span></div>
          <div class="between"><span class="muted">Boutique</span><span>{order.shopName}</span></div>
        </div>
      </main>
    </>
  );
}

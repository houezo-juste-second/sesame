/** Parcours livreur (/l/:id#t=…) : mission → scan du sésame → paiement immédiat. */
import { useCallback, useEffect, useState } from 'preact/hooks';
import { decodeSesameQr } from '@sesame/core';
import { api, ApiError, linkToken, subscribe, xof, type OrderView } from '../api.js';
import { Check, Scan } from '../ui/icons.js';
import { Brand, ErrorBox, Loading, SimBanner } from '../ui/kit.js';
import type { Scanner as ScannerType } from '../ui/Scanner.js';

/** Le lecteur QR (jsQR) n'est téléchargé que par le livreur, au premier usage. */
function useScanner(enabled: boolean): typeof ScannerType | null {
  const [C, setC] = useState<typeof ScannerType | null>(null);
  useEffect(() => {
    if (enabled && !C) void import('../ui/Scanner.js').then((m) => setC(() => m.Scanner));
  }, [enabled]);
  return C;
}

export function CourierMission({ id }: { id: string }) {
  const [token] = useState(() => linkToken('l', id));
  const [order, setOrder] = useState<OrderView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const Scanner = useScanner(scanning);

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

  async function release(text: string) {
    setScanning(false);
    const s = decodeSesameQr(text.trim());
    if (!s) return setError("Ce QR n'est pas un sésame. Demandez au client d'afficher son sésame dans Sésame.");
    if (s.orderId !== id) return setError('Ce sésame correspond à une autre commande.');
    setBusy(true);
    setError(null);
    try {
      await api(`/api/orders/${id}/release`, { token, body: { preimage: s.preimage } });
      if ('vibrate' in navigator) navigator.vibrate?.(120);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Une erreur est survenue.');
    } finally {
      setBusy(false);
    }
  }

  if (!token) return <div class="screen night"><div class="content"><ErrorBox message="Lien de mission incomplet. Demandez à la vendeuse de vous le renvoyer." /></div></div>;
  if (!order) return <div class="screen night">{error ? <div class="content"><ErrorBox message={error} /></div> : <Loading />}</div>;

  if (order.state === 'RELEASED') {
    return (
      <div class="screen">
        <SimBanner show={order.simulation} />
        <main class="content center fade-in" style="justify-content:center;gap:18px">
          <div class="success-burst"><div><Check size={38} /></div></div>
          <h1>Livraison confirmée</h1>
          <p class="muted" style="margin:0;line-height:1.5">Vous pouvez remettre le colis. La vendeuse vient d'être payée.</p>
          <div class="card stack small" style="text-align:left">
            <div class="between"><span class="muted">Vous avez reçu</span><span class="big-amount" style="color:var(--green)">+{xof(order.courierFeeXof ?? 0)}</span></div>
            <div class="divider" />
            <div class="between"><span class="muted">Commande</span><span>{order.itemLabel}</span></div>
            <div class="between"><span class="muted">Boutique</span><span>{order.shopName}</span></div>
          </div>
        </main>
      </div>
    );
  }

  const ready = order.state === 'FUNDS_LOCKED' || order.state === 'OUT_FOR_DELIVERY';
  return (
    <div class="screen night">
      <SimBanner show={order.simulation} />
      <header class="top" style="flex-direction:column;align-items:flex-start;gap:4px">
        <Brand />
        <div class="tiny" style="color:#A9ABC6;text-transform:uppercase;letter-spacing:0.4px;margin-top:8px">Mission</div>
        <h2 style="font-size:18px">{order.shopName} → {order.itemLabel}</h2>
        <div class="row" style="gap:8px;margin-top:6px;flex-wrap:wrap">
          <span class="pill" style="background:rgba(245,181,63,0.16);color:#F5C766">Votre course : {xof(order.courierFeeXof ?? 0)}</span>
          <span class="pill" style="background:rgba(255,255,255,0.08);color:#D6D7E6">
            {ready ? 'Paiement client bloqué ✓' : order.state === 'REFUNDED' ? 'Commande remboursée' : order.state === 'EXPIRED' ? 'Commande expirée' : 'Client pas encore payé'}
          </span>
        </div>
      </header>

      <main class="content" style="justify-content:center;align-items:center;gap:22px">
        {ready ? (
          <>
            {scanning && Scanner ? (
              <Scanner onResult={(t) => void release(t)} onError={(m) => { setScanning(false); setError(m); }} />
            ) : (
              <div class="viewfinder" aria-hidden="true"><span class="corner tl" /><span class="corner tr" /><span class="corner bl" /><span class="corner br" /></div>
            )}
            <div class="center stack" style="gap:6px">
              <h2 style="font-size:18px">Scannez le sésame du client</h2>
              <div class="small" style="color:#A9ABC6;line-height:1.45;max-width:290px;margin:0 auto">
                Remettez le colis <strong style="color:#fff">seulement</strong> après le scan réussi. Vous êtes payé à la seconde.
              </div>
            </div>
          </>
        ) : (
          <div class="card small" style="background:rgba(255,255,255,0.06);border:0;color:#D6D7E6;line-height:1.5">
            {order.state === 'REFUNDED' || order.state === 'EXPIRED'
              ? "Cette commande n'est plus active. Ne livrez pas : rapportez le colis à la vendeuse."
              : "Le client n'a pas encore payé. Attendez « Paiement client bloqué ✓ » avant de partir."}
          </div>
        )}
        {error && <ErrorBox message={error} />}
      </main>

      {ready && (
        <footer class="bottom clear">
          {manual ? (
            <form class="stack" onSubmit={(e) => { e.preventDefault(); void release(code); }}>
              <label class="label" for="code">Sésame copié par le client</label>
              <input id="code" class="input" style="color:var(--ink)" value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} placeholder="sesame:…" autocomplete="off" />
              <button class="btn saffron" disabled={busy || code.length < 10}>Valider</button>
            </form>
          ) : (
            <>
              <button class="btn saffron" disabled={busy} onClick={() => { setError(null); setScanning(!scanning); }}>
                <Scan color="#1A1300" /> {scanning ? 'Arrêter la caméra' : 'Ouvrir la caméra'}
              </button>
              <button class="btn ghost" onClick={() => setManual(true)}>Coller le sésame du client</button>
            </>
          )}
          <div class="tiny center" style="color:#A9ABC6">Le client peut aussi confirmer lui-même avec « J'ai reçu mon colis ».</div>
        </footer>
      )}
    </div>
  );
}

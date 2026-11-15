import { render, type FunctionComponent } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource-variable/atkinson-hyperlegible-next/wght.css';
import './styles.css';
import { match, usePath } from './router.js';
import { Home } from './screens/Home.js';
import { ClientOrder } from './screens/ClientOrder.js';
import { CourierMission } from './screens/CourierMission.js';
import { SellerHome, SellerNewOrder, SellerOrder, SellerPayout, SellerWallet } from './screens/Seller.js';
import { DemoBar, DemoStart, getDemo } from './demo.js';

/** La page de vérification (cryptographie Nostr) n'est téléchargée que si on l'ouvre. */
function LazyVerify({ slug }: { slug: string }) {
  const [C, setC] = useState<FunctionComponent<{ slug: string }> | null>(null);
  useEffect(() => { void import('./screens/Verify.js').then((m) => setC(() => m.Verify)); }, []);
  return C ? <C slug={slug} /> : <div class="content center muted">Chargement…</div>;
}

/** L'administration n'est téléchargée que par l'administrateur. */
function LazyAdmin() {
  const [C, setC] = useState<FunctionComponent | null>(null);
  useEffect(() => { void import('./screens/Admin.js').then((m) => setC(() => m.Admin)); }, []);
  return C ? <C /> : <div class="content center muted">Chargement…</div>;
}

function App() {
  const path = usePath();
  const screen = route(path);
  // Démo guidée : barre de rôles au-dessus des écrans de la commande de démo.
  const demo = getDemo();
  const inDemo = demo && (path.includes(demo.orderId) || path === '/v');
  return inDemo ? <><DemoBar demo={demo} path={path} />{screen}</> : screen;
}

function route(path: string) {
  let m: Record<string, string> | null;
  if (match('/demo', path)) return <DemoStart />;
  if (match('/admin', path)) return <LazyAdmin />;
  if ((m = match('/c/:id', path))) return <ClientOrder key={m.id} id={m.id!} />;
  if ((m = match('/l/:id', path))) return <CourierMission key={m.id} id={m.id!} />;
  if ((m = match('/verify/:slug', path))) return <LazyVerify key={m.slug} slug={m.slug!} />;
  if ((m = match('/v/o/:id', path))) return <SellerOrder key={m.id} id={m.id!} />;
  if (match('/v/new', path)) return <SellerNewOrder />;
  if (match('/v/payout', path)) return <SellerPayout />;
  if (match('/v/wallet', path)) return <SellerWallet />;
  if (match('/v', path)) return <SellerHome />;
  return <Home />;
}

render(<App />, document.getElementById('app')!);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}

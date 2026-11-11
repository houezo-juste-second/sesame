import { render, type FunctionComponent } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import '@fontsource-variable/inter';
import '@fontsource-variable/plus-jakarta-sans';
import './styles.css';
import { match, usePath } from './router.js';
import { Home } from './screens/Home.js';
import { ClientOrder } from './screens/ClientOrder.js';
import { CourierMission } from './screens/CourierMission.js';
import { SellerHome, SellerNewOrder, SellerOrder } from './screens/Seller.js';

/** La page de vérification (cryptographie Nostr) n'est téléchargée que si on l'ouvre. */
function LazyVerify({ slug }: { slug: string }) {
  const [C, setC] = useState<FunctionComponent<{ slug: string }> | null>(null);
  useEffect(() => { void import('./screens/Verify.js').then((m) => setC(() => m.Verify)); }, []);
  return C ? <C slug={slug} /> : <div class="content center muted">Chargement…</div>;
}

function App() {
  const path = usePath();
  let m: Record<string, string> | null;
  if ((m = match('/c/:id', path))) return <ClientOrder key={m.id} id={m.id!} />;
  if ((m = match('/l/:id', path))) return <CourierMission key={m.id} id={m.id!} />;
  if ((m = match('/verify/:slug', path))) return <LazyVerify key={m.slug} slug={m.slug!} />;
  if ((m = match('/v/o/:id', path))) return <SellerOrder key={m.id} id={m.id!} />;
  if (match('/v/new', path)) return <SellerNewOrder />;
  if (match('/v', path)) return <SellerHome />;
  return <Home />;
}

render(<App />, document.getElementById('app')!);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}

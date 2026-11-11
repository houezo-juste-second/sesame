import { render } from 'preact';
import '@fontsource-variable/inter';
import '@fontsource-variable/plus-jakarta-sans';
import './styles.css';
import { match, usePath } from './router.js';
import { Home } from './screens/Home.js';
import { ClientOrder } from './screens/ClientOrder.js';
import { CourierMission } from './screens/CourierMission.js';
import { SellerHome, SellerNewOrder, SellerOrder } from './screens/Seller.js';

function App() {
  const path = usePath();
  let m: Record<string, string> | null;
  if ((m = match('/c/:id', path))) return <ClientOrder key={m.id} id={m.id!} />;
  if ((m = match('/l/:id', path))) return <CourierMission key={m.id} id={m.id!} />;
  if ((m = match('/v/o/:id', path))) return <SellerOrder key={m.id} id={m.id!} />;
  if (match('/v/new', path)) return <SellerNewOrder />;
  if (match('/v', path)) return <SellerHome />;
  return <Home />;
}

render(<App />, document.getElementById('app')!);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}

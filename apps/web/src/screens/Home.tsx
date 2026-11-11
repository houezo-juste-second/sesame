import { navigate } from '../router.js';
import { Key, Lock, Shield } from '../ui/icons.js';
import { Brand } from '../ui/kit.js';

const steps = [
  { icon: <Lock />, title: 'Le client paie avant', text: "Son argent est bloqué : ni la vendeuse ni Sésame ne peuvent le prendre." },
  { icon: <Key />, title: 'Il reçoit son colis', text: 'Il vérifie, puis montre son sésame au livreur.' },
  { icon: <Shield />, title: 'Tout le monde est payé', text: 'Vendeuse et livreur à la seconde. Sans livraison : remboursement automatique.' },
];

export function Home() {
  return (
    <div class="screen">
      <header class="top"><Brand /></header>
      <main class="content fade-in" style="gap:22px">
        <section class="stack" style="gap:12px;padding-top:12px">
          <h1 style="font-size:30px;line-height:1.15">Le paiement à la livraison, sans cash et sans fausse capture.</h1>
          <p class="muted" style="margin:0;line-height:1.5">
            Pour les vendeuses sur WhatsApp, Instagram et TikTok, à Dakar, Cotonou et partout en zone UEMOA. Propulsé par Bitcoin Lightning.
          </p>
        </section>
        <ol class="stack" style="list-style:none;padding:0;margin:0;gap:10px">
          {steps.map((s, i) => (
            <li key={i} class="card row" style="align-items:flex-start;gap:12px">
              <span class="brand-mark" style="width:36px;height:36px;border-radius:10px">{s.icon}</span>
              <div>
                <strong style="font-size:15px">{i + 1}. {s.title}</strong>
                <div class="small muted" style="margin-top:2px;line-height:1.45">{s.text}</div>
              </div>
            </li>
          ))}
        </ol>
        <div class="card soft small" style="color:var(--indigo-ink);line-height:1.5">
          <strong>Sésame ne garde jamais votre argent.</strong> Il est verrouillé par le réseau Lightning, et seul le client détient la clé qui le libère.
        </div>
      </main>
      <footer class="bottom">
        <a class="btn primary" href="/v" onClick={(e) => { e.preventDefault(); navigate('/v'); }}>Je vends en ligne</a>
        <div class="tiny muted center">Vous êtes client ou livreur ? Ouvrez le lien reçu sur WhatsApp.</div>
      </footer>
    </div>
  );
}

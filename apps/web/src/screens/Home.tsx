import { navigate } from '../router.js';
import { KeyHole, Lock } from '../ui/icons.js';
import { Brand } from '../ui/kit.js';

const go = (path: string) => (e: Event) => { e.preventDefault(); navigate(path); };

const steps = [
  { title: 'Le client paie avant la livraison', text: 'Son argent est bloqué : ni la vendeuse, ni le livreur, ni Sésame ne peuvent le prendre.' },
  { title: 'Il vérifie son colis', text: 'Puis il montre son sésame au livreur, qui le scanne.' },
  { title: 'Tout le monde est payé à la seconde', text: "La vendeuse et le livreur. Si rien n'est livré à temps, le client est remboursé automatiquement." },
];

export function Home() {
  return (
    <div class="screen">
      <header class="top">
        <Brand />
        <span class="grow" />
        <a class="chip-link" href="/v" onClick={go('/v')}>Espace vendeuse</a>
      </header>
      <main class="content fade-in" style="gap:26px">
        <section class="stack" style="gap:14px;padding-top:8px">
          <h1 class="display">Le client paie avant.<br />Vous êtes payée à la livraison.</h1>
          <p class="lede">Le paiement à la livraison sans cash et sans fausse capture, pour les ventes sur WhatsApp, Instagram et TikTok.</p>
        </section>

        <section class="chat" aria-label="Exemple : la commande envoyée au client sur WhatsApp">
          <div class="bubble theirs">
            <div class="who">Pagnes de Fifamè</div>
            Voici votre commande. Votre argent reste bloqué jusqu'à la livraison.
            <div class="preview" aria-hidden="true">
              <div class="preview-head"><KeyHole size={16} /> Sésame</div>
              <div class="preview-body">
                <span class="small muted">2 pagnes wax bleus, livrés à Fidjrossè</span>
                <strong class="num" style="font-family:var(--font-display);font-size:20px">19 500 FCFA</strong>
              </div>
              <div class="preview-pay">Payer en sécurité</div>
            </div>
            <span class="time">10:42</span>
          </div>
          <div class="bubble mine">C'est payé. J'attends le livreur 👍<span class="time">10:44</span></div>
        </section>

        <section class="stack" style="gap:16px">
          <h2>Comment ça marche</h2>
          <ol class="steps">
            {steps.map((s, i) => (
              <li key={i}>
                <span class="step-node" aria-hidden="true">{i + 1}</span>
                <div><h3>{s.title}</h3><p>{s.text}</p></div>
              </li>
            ))}
          </ol>
        </section>

        <section class="trust">
          <span class="trust-icon"><Lock size={17} /></span>
          <p class="small muted" style="line-height:1.5">
            <strong style="color:var(--ink)">Sésame ne garde jamais l'argent.</strong> Il est verrouillé par le réseau Bitcoin Lightning, et seul le client détient la clé qui le libère.
          </p>
        </section>
      </main>
      <footer class="bottom">
        <a class="btn primary" href="/v" onClick={go('/v')}>Je vends en ligne</a>
        <div class="tiny muted center">Client ou livreur ? Ouvrez le lien reçu sur WhatsApp.</div>
      </footer>
    </div>
  );
}

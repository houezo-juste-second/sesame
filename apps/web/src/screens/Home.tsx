import { navigate } from '../router.js';
import { t } from '../i18n.js';
import { Bag, Bike, Lock, Play, Seed, Store } from '../ui/icons.js';
import { Brand, LangToggle } from '../ui/kit.js';

const go = (path: string) => (e: Event) => { e.preventDefault(); navigate(path); };

export function Home() {
  const steps = [
    { title: t('Le client paie avant la livraison'), text: t('Son argent est bloqué : ni la vendeuse, ni le livreur, ni Sésame ne peuvent le prendre.') },
    { title: t('Il vérifie son colis'), text: t('Puis il montre son sésame au livreur, qui le scanne.') },
    { title: t('Tout le monde est payé à la seconde'), text: t("La vendeuse et le livreur. Si rien n'est livré à temps, le client est remboursé automatiquement.") },
  ];
  return (
    <div class="screen">
      <header class="top">
        <Brand />
        <span class="grow" />
        <LangToggle />
        <a class="chip-link" href="/v" onClick={go('/v')}>{t('Espace vendeuse')}</a>
      </header>
      <main class="content fade-in" style="gap:28px">
        <section class="stack" style="gap:14px;padding-top:8px">
          <h1 class="display">{t('Le client paie avant.')}<br />{t('Vous êtes payée à la livraison.')}</h1>
          <p class="lede">{t('Le paiement à la livraison sans cash et sans fausse capture, pour les ventes sur WhatsApp, Instagram et TikTok. Le client paie en Mobile Money, vous êtes payée en Mobile Money.')}</p>
        </section>

        <section class="chat" aria-label={t('Exemple : la commande envoyée au client sur WhatsApp')}>
          <div class="bubble theirs">
            <div class="who">Pagnes de Fifamè</div>
            {t("Voici votre commande. Votre argent reste bloqué jusqu'à la livraison.")}
            <div class="preview" aria-hidden="true">
              <div class="preview-head"><Seed size={18} hole="#18205C" /> Sésame</div>
              <div class="preview-body">
                <span class="small muted">{t('2 pagnes wax bleus, livrés à Fidjrossè')}</span>
                <strong class="num" style="font-size:20px">19 500 FCFA</strong>
              </div>
              <div class="preview-pay">{t('Payer en sécurité')}</div>
            </div>
            <span class="time">10:42</span>
          </div>
          <div class="bubble mine">{t("C'est payé. J'attends le livreur 👍")}<span class="time">10:44</span></div>
        </section>

        <section class="stack" style="gap:14px">
          <h2>{t('Qui fait quoi')}</h2>
          <p class="muted small">{t('Seule la vendeuse a un compte. Le client et le livreur reçoivent un lien sur WhatsApp : rien à installer, aucun compte à créer.')}</p>
          <div class="list roles">
            <div class="role">
              <span class="role-icon"><Store size={20} /></span>
              <div class="grow">
                <h3>{t('La vendeuse')}</h3>
                <p>{t('Crée la commande, envoie le lien de paiement au client, puis la mission au livreur. Elle suit tout depuis son tableau de bord.')}</p>
                <a class="role-action" href="/v" onClick={go('/v')}>{t("Ouvrir l'espace vendeuse")}</a>
              </div>
            </div>
            <div class="role">
              <span class="role-icon"><Bag size={20} /></span>
              <div class="grow">
                <h3>{t('Le client')}</h3>
                <p>{t('Ouvre le lien reçu, paie : son argent est bloqué. À la livraison, il vérifie le colis puis montre son sésame.')}</p>
              </div>
            </div>
            <div class="role">
              <span class="role-icon"><Bike size={20} /></span>
              <div class="grow">
                <h3>{t('Le livreur')}</h3>
                <p>{t('Ouvre le lien de mission, voit que le client a déjà payé, scanne le sésame et reçoit sa course aussitôt. Plus de cash sur lui.')}</p>
              </div>
            </div>
          </div>
        </section>

        <section class="stack" style="gap:16px">
          <h2>{t('Comment ça marche')}</h2>
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
            <strong style="color:var(--ink)">{t("Pendant la livraison, personne ne peut prendre l'argent, pas même Sésame.")}</strong>{' '}
            {t("En arrière-plan, il est verrouillé par le réseau Bitcoin Lightning, et seul le client détient la clé qui le libère. Vous n'avez pas besoin de connaître le bitcoin.")}
          </p>
        </section>
      </main>
      <footer class="bottom">
        <a class="btn saffron" href="/demo" onClick={go('/demo')}><Play /> {t('Essayer les 3 rôles en 2 minutes')}</a>
        <div class="tiny muted center">{t('Démonstration sans compte et sans argent réel, sur ce téléphone')}</div>
      </footer>
    </div>
  );
}

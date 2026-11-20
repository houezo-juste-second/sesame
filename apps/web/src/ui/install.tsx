/**
 * « Installer Sésame sur mon téléphone » (application web installable).
 * Android / Chrome / Edge : le navigateur propose l'installation ; on garde son invitation pour un bouton à un toucher.
 * iPhone (Safari) : pas d'invitation possible ; on montre les deux gestes à faire.
 * Le bouton ne s'affiche jamais si Sésame est déjà installé ou si l'installation est impossible.
 */
import { useEffect, useState } from 'preact/hooks';
import { t } from '../i18n.js';
import { Chevron, Download } from './icons.js';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // on garde l'invitation pour notre bouton
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    notify();
  });
}

function isStandalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

function useInstall() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  const done = installed || isStandalone();
  return { done, canPrompt: !done && deferred !== null, ios: !done && isIos() };
}

async function promptInstall(): Promise<void> {
  const e = deferred;
  if (!e) return;
  deferred = null;
  await e.prompt();
  if ((await e.userChoice).outcome === 'accepted') installed = true;
  notify();
}

/** Bouton d'installation. `variant="row"` : ligne de l'espace vendeuse ; `"button"` : bouton secondaire de l'accueil. */
export function InstallApp({ variant }: { variant: 'row' | 'button' }) {
  const { done, canPrompt, ios } = useInstall();
  const [help, setHelp] = useState(false);
  if (done || (!canPrompt && !ios)) return null;

  const onClick = () => (canPrompt ? void promptInstall() : setHelp((h) => !h));
  const label = t('Installer Sésame sur mon téléphone');
  const iosHelp = help && (
    <p class="install-help small" role="note">
      {t('Sur iPhone, dans Safari : touchez le bouton Partager (le carré avec une flèche), puis « Sur l’écran d’accueil ».')}
    </p>
  );

  if (variant === 'row') {
    return (
      <>
        <button type="button" class="link-row install-row" onClick={onClick} aria-expanded={ios ? help : undefined}>
          <span class="link-icon"><Download size={18} color="var(--indigo)" /></span>
          <span class="grow">
            <strong style="display:block;font-size:15px">{label}</strong>
            <span class="tiny muted">{t('Comme une application : une icône sur l’écran d’accueil, ouverture en plein écran')}</span>
          </span>
          <span class="chev"><Chevron /></span>
        </button>
        {iosHelp}
      </>
    );
  }
  return (
    <>
      <button type="button" class="btn ghost install-btn" onClick={onClick} aria-expanded={ios ? help : undefined}>
        <Download size={18} /> {label}
      </button>
      {iosHelp}
    </>
  );
}

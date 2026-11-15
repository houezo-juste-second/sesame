/**
 * Langues de l'interface : français (par défaut pour nos utilisateurs) et anglais.
 * Le texte français sert de clé : t('Payer {amount}', { amount }) → « Pay {amount} » en anglais.
 * Une clé absente du dictionnaire anglais s'affiche en français (jamais d'écran vide).
 */
import { useEffect, useState } from 'preact/hooks';
// Le dictionnaire anglais n'est téléchargé que si l'anglais est choisi : l'appli reste légère en français.
let EN: Record<string, string> = {};

export type Lang = 'fr' | 'en';
const KEY = 'sesame:lang';

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'fr' || saved === 'en') return saved;
  } catch { /* stockage indisponible */ }
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'fr').toLowerCase();
  return nav.startsWith('fr') ? 'fr' : 'en';
}

let lang: Lang = initial();
if (typeof document !== 'undefined') document.documentElement.lang = lang;

export const getLang = (): Lang => lang;

/** Charge le dictionnaire de la langue (anglais uniquement) avant d'afficher. */
export async function loadLang(l: Lang = lang): Promise<void> {
  if (l === 'en' && Object.keys(EN).length === 0) {
    try { EN = (await import('./i18n.en.js')).EN; } catch { /* hors ligne : on reste en français */ }
  }
}

export async function setLang(next: Lang): Promise<void> {
  await loadLang(next);
  lang = next;
  try { localStorage.setItem(KEY, next); } catch { /* ignoré */ }
  document.documentElement.lang = next;
  dispatchEvent(new Event('sesame:lang'));
}

/** Composant qui se redessine quand la langue change. */
export function useLang(): Lang {
  const [, force] = useState(0);
  useEffect(() => {
    const on = () => force((n) => n + 1);
    addEventListener('sesame:lang', on);
    return () => removeEventListener('sesame:lang', on);
  }, []);
  return lang;
}

export function t(fr: string, vars?: Record<string, string | number>): string {
  let s = lang === 'en' ? EN[fr] ?? fr : fr;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
  return s;
}

/** Locale des dates et heures. */
export const locale = (): string => (lang === 'en' ? 'en-GB' : 'fr-FR');

const STATES_EN: Record<string, string> = {
  DRAFT: 'Draft', AWAITING_PAYMENT: 'Awaiting payment', FUNDS_LOCKED: 'Payment secured',
  OUT_FOR_DELIVERY: 'Out for delivery', RELEASED: 'Delivered and paid', REFUNDED: 'Refunded', EXPIRED: 'Expired',
};

/** Libellé d'état : celui du serveur en français, traduit côté client en anglais. */
export const stateLabel = (state: string, fr: string): string => (lang === 'en' ? STATES_EN[state] ?? fr : fr);

const ERRORS_EN: Record<string, string> = {
  OFFLINE: 'No connection. Check your network and try again.',
  BAD_PIN: 'Wrong PIN.',
  BAD_CODE: 'Wrong access code.',
  RATE_LIMITED: 'Too many attempts. Try again in a minute.',
  UNAUTHORIZED: 'Invalid or expired link.',
  FORBIDDEN: 'This action is not allowed for you.',
  VALIDATION: 'Invalid data. Check the form fields.',
  NOT_FOUND: 'Not found.',
  SHOP_NOT_FOUND: 'Shop not found.',
  ORDER_NOT_FOUND: 'Order not found.',
  SHOP_SUSPENDED: 'This shop is suspended. Contact Sésame support.',
  PREIMAGE_MISMATCH: 'This sésame does not match this order.',
  DEADLINE_PASSED: 'The deadline has passed: the buyer is being refunded.',
  ORDER_NOT_LOCKABLE: 'This order can no longer be paid.',
  ORDER_NOT_RELEASABLE: 'This order cannot be released.',
  ORDER_NOT_CANCELLABLE: 'This order can no longer be cancelled.',
  ORDER_NOT_ASSIGNABLE: 'A courier can only be assigned once the payment is secured.',
  REAL_WALLET: 'Real payment: pay with your Lightning wallet by scanning the QR.',
  ORDERS_PENDING: 'Paid orders are still waiting for delivery. Disconnect the wallet afterwards.',
  WALLET_UNREACHABLE: 'The wallet is not responding on its relays. Check that it is on and connected.',
  WALLET_TIMEOUT: "The seller's wallet is not responding. Try again in a moment.",
  WALLET_BAD_RESPONSE: 'Unreadable response from the wallet.',
  HOLD_UNSUPPORTED: 'This wallet does not support hold invoices. Use a compatible wallet (e.g. an up-to-date Alby Hub).',
  INVALID_URI: 'Invalid connection code: it must start with nostr+walletconnect://',
  INTERNAL: 'Internal error. Try again in a moment.',
  NO_STORAGE: 'This browser cannot keep your sésame (private browsing?). Open the link in a normal browser.',
};

/** Message d'erreur lisible dans la langue choisie. */
export function errorText(e: unknown, fallbackFr = 'Une erreur est survenue.'): string {
  const err = e as { code?: string; message?: string } | null;
  if (lang === 'en') return (err?.code && ERRORS_EN[err.code]) || (err?.message && EN[err.message]) || EN[fallbackFr] || 'Something went wrong.';
  return err?.message || fallbackFr;
}

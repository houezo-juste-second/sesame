import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import QRCode from 'qrcode';
import { Back, Lock } from './icons.js';
import { navigate } from '../router.js';

export function Brand() {
  return (
    <a class="brand" href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>
      <span class="brand-mark"><Lock size={16} /></span>
      Sésame
    </a>
  );
}

export function TopBar({ back, title, subtitle, right }: { back?: string; title?: string; subtitle?: string; right?: ComponentChildren }) {
  return (
    <header class="top">
      {back ? (
        <a class="icon-btn" href={back} aria-label="Retour" onClick={(e) => { e.preventDefault(); navigate(back); }}>
          <Back />
        </a>
      ) : <Brand />}
      <div class="grow">
        {subtitle && <div class="tiny muted">{subtitle}</div>}
        {title && <h2>{title}</h2>}
      </div>
      {right}
    </header>
  );
}

export function SimBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return <div class="banner-sim" role="note">DÉMO — paiements simulés, aucun argent réel</div>;
}

export function Qr({ text, label }: { text: string; label: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(text, { margin: 0, width: 420, errorCorrectionLevel: 'M', color: { dark: '#12142B', light: '#FFFFFF' } })
      .then(setSrc)
      .catch(() => setSrc(''));
  }, [text]);
  return src ? <img src={src} alt={label} /> : <span class="tiny muted">Génération du QR…</span>;
}

export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function Toast({ text }: { text: string | null }) {
  if (!text) return null;
  return <div class="toast fade-in" role="status">{text}</div>;
}

export function useToast(): [string | null, (t: string) => void] {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!text) return;
    const t = setTimeout(() => setText(null), 2_500);
    return () => clearTimeout(t);
  }, [text]);
  return [text, setText];
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function whatsappUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

export function Loading() {
  return <div class="content center muted" style="justify-content:center">Chargement…</div>;
}

export function ErrorBox({ message }: { message: string }) {
  return <div class="card danger small" role="alert">{message}</div>;
}

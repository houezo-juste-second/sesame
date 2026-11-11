/** Client de l'API Sésame : jetons, appels JSON, flux temps réel. */

export type OrderState =
  | 'DRAFT' | 'AWAITING_PAYMENT' | 'FUNDS_LOCKED' | 'OUT_FOR_DELIVERY' | 'RELEASED' | 'REFUNDED' | 'EXPIRED';

export interface OrderView {
  id: string;
  shopName: string;
  shopSlug: string;
  shopCity: string;
  itemLabel: string;
  itemXof: number;
  deliveryFeeXof: number;
  totalXof: number;
  amountSat: string;
  deliveryHours: number;
  state: OrderState;
  stateLabel: string;
  invoiceExpiresAt: string | null;
  releaseDeadlineAt: string | null;
  courierAssigned: boolean;
  createdAt: string;
  simulation: boolean;
  bolt11?: string | null;
  courierFeeXof?: number;
  courierAddress?: string | null;
  feeXof?: number;
  netXof?: number;
  reputation?: { released: number; refunded: number };
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

// ------------------------------------------------------------ stockage local (tolérant aux erreurs)

export const local = {
  get(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch { /* navigation privée : on continue sans */ }
  },
  remove(key: string): void {
    try { localStorage.removeItem(key); } catch { /* idem */ }
  },
};

export const SELLER_KEY = 'sesame:seller';

/** Lit le jeton du lien (#t=…), le mémorise pour cette commande, puis le retire de l'URL. */
export function linkToken(role: 'c' | 'l', orderId: string): string | null {
  const key = `sesame:tok:${role}:${orderId}`;
  const m = /[#&]t=([A-Za-z0-9_-]{10,64})/.exec(location.hash);
  if (m) {
    local.set(key, m[1]!);
    history.replaceState(null, '', location.pathname);
    return m[1]!;
  }
  return local.get(key);
}

// ------------------------------------------------------------ appels

export async function api<T>(path: string, opts: { method?: string; token?: string | null; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      headers: {
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : null,
    });
  } catch {
    throw new ApiError(0, 'OFFLINE', 'Pas de connexion. Vérifiez votre réseau et réessayez.');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok && res.status !== 202) {
    throw new ApiError(res.status, data.error ?? 'ERROR', data.message ?? 'Une erreur est survenue.');
  }
  return data as T;
}

/** Flux SSE avec en-tête d'autorisation (EventSource ne le permet pas) et reconnexion automatique. */
export function subscribe(path: string, token: string, onEvent: (e: { type: string }) => void): () => void {
  let stopped = false;
  let controller: AbortController | null = null;

  const run = async () => {
    while (!stopped) {
      controller = new AbortController();
      try {
        const res = await fetch(path, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
        if (!res.ok || !res.body) throw new Error('SSE');
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let idx;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const chunk = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const line = chunk.split('\n').find((l) => l.startsWith('data: '));
            if (line) {
              try { onEvent(JSON.parse(line.slice(6))); } catch { /* ignoré */ }
            }
          }
        }
      } catch {
        /* réseau coupé : on réessaie */
      }
      if (!stopped) await new Promise((r) => setTimeout(r, 3_000));
    }
  };
  void run();
  return () => {
    stopped = true;
    controller?.abort();
  };
}

// ------------------------------------------------------------ format

const nf = new Intl.NumberFormat('fr-FR');
export const xof = (n: number) => `${nf.format(n)} FCFA`;
export const sats = (s: string | number) => `${nf.format(Number(s))} sats`;
export const initials = (name: string) =>
  name.split(/\s+/).filter((w) => w.length > 2 || /^[A-Z]/.test(w)).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || 'S';

export function timeLeft(iso: string | null, now = Date.now()): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return 'échéance atteinte';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

export const clock = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h') : '';

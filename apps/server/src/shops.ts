export interface Shop {
  id: string;
  slug: string;
  name: string;
  city: string;
  pinHash: string;
  /** Clé publique Nostr (hex) qui signe les reçus de la boutique. */
  nostrPubkey: string;
  createdAt: Date;
  /** Suspendue par l'administrateur : plus de connexion ni de nouvelle commande. */
  suspended: boolean;
  /** Créée par le parcours « Essayer la démo ». */
  demo: boolean;
}

/** Comment la vendeuse reçoit son argent. */
export type ShopPayout =
  | { method: 'momo'; operator: string; phone: string }
  | { method: 'lightning'; address: string };

export const MOMO_OPERATORS = ['MTN MoMo', 'Moov Money', 'Celtiis Cash', 'Wave', 'Orange Money', 'Free Money'] as const;

/** Libellé sans le numéro complet : « MTN MoMo •• 42 ». */
export function payoutLabel(p: ShopPayout | undefined): string | null {
  if (!p) return null;
  return p.method === 'momo' ? `${p.operator} •• ${p.phone.slice(-2)}` : p.address;
}

/** Destination enregistrée dans la commande (sans le numéro complet). */
export function payoutDestination(p: ShopPayout | undefined): string | undefined {
  if (!p || p.method !== 'momo') return undefined;
  return `momo:${p.operator}:${p.phone.slice(-2)}`;
}

export interface ShopStore {
  create(input: { name: string; city: string; pinHash: string; demo?: boolean }): Shop;
  list(): Shop[];
  setSuspended(id: string, suspended: boolean): void;
  getPayout(id: string): ShopPayout | undefined;
  setPayout(id: string, payout: ShopPayout): void;
  get(id: string): Shop | undefined;
  bySlug(slug: string): Shop | undefined;
  /** Clé secrète Nostr de la boutique (déchiffrée à la demande, jamais exposée par l'API). */
  nostrSecretKey(id: string): Uint8Array;
}

export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'boutique';
}

export interface Shop {
  id: string;
  slug: string;
  name: string;
  city: string;
  pinHash: string;
  /** Clé publique Nostr (hex) qui signe les reçus de la boutique. */
  nostrPubkey: string;
  createdAt: Date;
}

export interface ShopStore {
  create(input: { name: string; city: string; pinHash: string }): Shop;
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

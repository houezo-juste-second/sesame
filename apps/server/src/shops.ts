import { randomUUID } from 'node:crypto';

export interface Shop {
  id: string;
  slug: string;
  name: string;
  city: string;
  pinHash: string;
  createdAt: Date;
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

export class MemoryShopStore {
  private readonly shops = new Map<string, Shop>();

  create(input: { name: string; city: string; pinHash: string }): Shop {
    const base = slugify(input.name);
    let slug = base;
    for (let i = 2; [...this.shops.values()].some((s) => s.slug === slug); i++) slug = `${base}-${i}`;
    const shop: Shop = { id: randomUUID(), slug, createdAt: new Date(), ...input };
    this.shops.set(shop.id, shop);
    return shop;
  }

  get(id: string): Shop | undefined {
    return this.shops.get(id);
  }

  bySlug(slug: string): Shop | undefined {
    return [...this.shops.values()].find((s) => s.slug === slug);
  }
}

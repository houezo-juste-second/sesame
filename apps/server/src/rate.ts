/**
 * Taux FCFA / BTC. Le FCFA (XOF) a une parité fixe avec l'euro : 1 EUR = 655,957 XOF.
 * Source gratuite et sans clé : l'API publique de mempool.space (prix BTC en EUR).
 */
export const XOF_PER_EUR = 655.957;

export interface RateProvider {
  xofPerBtc(): Promise<number>;
}

export class FixedRate implements RateProvider {
  constructor(private readonly value: number) {}
  async xofPerBtc(): Promise<number> {
    return this.value;
  }
}

export class MempoolRate implements RateProvider {
  private cached: { value: number; at: number } | undefined;

  constructor(
    private readonly fallback: number,
    private readonly url = 'https://mempool.space/api/v1/prices',
    private readonly ttlMs = 60_000,
  ) {}

  async xofPerBtc(): Promise<number> {
    const now = Date.now();
    if (this.cached && now - this.cached.at < this.ttlMs) return this.cached.value;
    try {
      const res = await fetch(this.url, { signal: AbortSignal.timeout(4_000) });
      const body = (await res.json()) as { EUR?: number };
      if (!res.ok || typeof body.EUR !== 'number' || body.EUR <= 0) throw new Error('BAD_RATE');
      const value = Math.round(body.EUR * XOF_PER_EUR);
      this.cached = { value, at: now };
      return value;
    } catch {
      return this.cached?.value ?? this.fallback;
    }
  }
}

/**
 * Montants. Règle : les FCFA sont des entiers, les montants Lightning sont des
 * millisatoshis en BigInt. Le taux est figé à la création de la commande.
 */
export const MSAT_PER_BTC = 100_000_000_000n;

/** Plafond de sécurité par commande pour le MVP. */
export const MAX_ORDER_XOF = 5_000_000;

function assertPositiveInt(name: string, v: number): void {
  if (!Number.isSafeInteger(v) || v <= 0) throw new Error(`INVALID_${name}`);
}

/** Convertit des FCFA en msat (arrondi à l'inférieur) au taux `xofPerBtc`. */
export function xofToMsat(amountXof: number, xofPerBtc: number): bigint {
  assertPositiveInt('AMOUNT', amountXof);
  assertPositiveInt('RATE', xofPerBtc);
  if (amountXof > MAX_ORDER_XOF) throw new Error('AMOUNT_ABOVE_LIMIT: plafond de 5 000 000 FCFA dépassé');
  return (BigInt(amountXof) * MSAT_PER_BTC) / BigInt(xofPerBtc);
}

export function msatToSat(msat: bigint): bigint {
  return msat / 1000n;
}

export interface FeeOptions {
  pro?: boolean;
}

/** Frais de service : 1 % (0,6 % en Pro) du prix de l'article, borné à [25 ; 1 000] FCFA. */
export function serviceFeeXof(itemXof: number, opts: FeeOptions = {}): number {
  assertPositiveInt('AMOUNT', itemXof);
  const rate = opts.pro ? 0.006 : 0.01;
  return Math.min(1_000, Math.max(25, Math.round(itemXof * rate)));
}

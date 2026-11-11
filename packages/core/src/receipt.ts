/**
 * Reçus vérifiables publiés sur Nostr (NIP-78, kind 30078).
 * Signés par la clé Nostr de la boutique. Aucune donnée personnelle :
 * identifiant de commande haché, montant arrondi à 500 FCFA, heure arrondie.
 * Un reçu « released » contient la preuve de paiement : SHA-256(preimage) = payment_hash.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { finalizeEvent, verifyEvent, type Event, type VerifiedEvent } from 'nostr-tools/pure';
import { verifyPreimage } from './sesame.js';

export const RECEIPT_KIND = 30078;
export const RECEIPT_D_PREFIX = 'sesame:receipt:';

export interface ReceiptInput {
  orderId: string;
  outcome: 'released' | 'refunded';
  totalXof: number;
  paymentHash: string;
  /** Requis si outcome = released. */
  preimage?: string | undefined;
  at: Date;
}

export function receiptDTag(orderId: string): string {
  return RECEIPT_D_PREFIX + bytesToHex(sha256(utf8ToBytes(`sesame:${orderId}`)));
}

export function createReceipt(input: ReceiptInput, shopSecretKey: Uint8Array): VerifiedEvent {
  if (input.outcome === 'released' && !input.preimage) throw new Error('RECEIPT_MISSING_PREIMAGE');
  const tags: string[][] = [
    ['d', receiptDTag(input.orderId)],
    ['t', 'sesame'],
    ['outcome', input.outcome],
    ['amount_xof', String(Math.round(input.totalXof / 500) * 500)],
    ['payment_hash', input.paymentHash],
  ];
  if (input.outcome === 'released') tags.push(['preimage', input.preimage!]);
  const hour = Math.floor(input.at.getTime() / 3_600_000) * 3_600;
  return finalizeEvent(
    { kind: RECEIPT_KIND, created_at: hour, tags, content: input.outcome === 'released' ? 'Livraison confirmée via Sésame' : 'Client remboursé via Sésame' },
    shopSecretKey,
  );
}

export interface ReceiptCheck {
  valid: boolean;
  outcome: 'released' | 'refunded' | null;
  proofOfPayment: boolean;
}

/** Vérifie la signature ET, pour une livraison, la preuve de paiement. */
export function checkReceipt(ev: Event): ReceiptCheck {
  const tag = (n: string) => ev.tags.find((t) => t[0] === n)?.[1];
  const outcome = tag('outcome');
  const isSesame = ev.kind === RECEIPT_KIND && tag('d')?.startsWith(RECEIPT_D_PREFIX) && (outcome === 'released' || outcome === 'refunded');
  let signed = false;
  try {
    // verifyEvent recalcule l'identifiant et vérifie la signature Schnorr.
    // On reconstruit un objet « propre » : nostr-tools mémorise le résultat d'une vérification
    // dans une propriété cachée, qu'une simple copie ({ ...ev }) transporterait.
    const { id, pubkey, created_at, kind, tags, content, sig } = ev;
    signed = verifyEvent({ id, pubkey, created_at, kind, tags: tags.map((t) => [...t]), content, sig });
  } catch {
    signed = false;
  }
  if (!isSesame || !signed) return { valid: false, outcome: null, proofOfPayment: false };
  if (outcome === 'refunded') return { valid: true, outcome, proofOfPayment: false };
  const proof = verifyPreimage(tag('preimage') ?? '', tag('payment_hash') ?? '');
  return { valid: proof, outcome: 'released', proofOfPayment: proof };
}

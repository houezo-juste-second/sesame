/**
 * Le « sésame » : secret P de 32 octets généré sur l'appareil du client.
 * Seule son empreinte H = SHA-256(P) quitte le téléphone avant la livraison.
 * La facture hold de la vendeuse est liée à H : elle ne peut être encaissée qu'avec P.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js';

const HEX32 = /^[0-9a-f]{64}$/;

export interface Sesame {
  /** P — secret, à ne montrer qu'au moment de la remise du colis. */
  preimage: string;
  /** H = SHA-256(P) — public, sert à créer la facture hold. */
  paymentHash: string;
}

export function isHex32(value: string): boolean {
  return HEX32.test(value.toLowerCase());
}

export function generateSesame(): Sesame {
  const preimage = bytesToHex(randomBytes(32));
  return { preimage, paymentHash: hashPreimage(preimage) };
}

export function hashPreimage(preimageHex: string): string {
  const p = preimageHex.toLowerCase();
  if (!HEX32.test(p)) throw new Error('INVALID_PREIMAGE');
  return bytesToHex(sha256(hexToBytes(p)));
}

/** Comparaison en temps constant de deux chaînes hexadécimales de même longueur. */
function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Vrai si SHA-256(P) = H. Ne lève jamais d'exception sur une entrée mal formée. */
export function verifyPreimage(preimageHex: string, paymentHashHex: string): boolean {
  const p = preimageHex.toLowerCase();
  const h = paymentHashHex.toLowerCase();
  if (!HEX32.test(p) || !HEX32.test(h)) return false;
  return constantTimeEqualHex(hashPreimage(p), h);
}

const QR_PREFIX = 'sesame:';

/** Contenu du QR montré au livreur : `sesame:<orderId>.<P>`. */
export function encodeSesameQr(orderId: string, preimageHex: string): string {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(orderId)) throw new Error('INVALID_ORDER_ID');
  if (!isHex32(preimageHex)) throw new Error('INVALID_PREIMAGE');
  return `${QR_PREFIX}${orderId}.${preimageHex.toLowerCase()}`;
}

export function decodeSesameQr(text: string): { orderId: string; preimage: string } | null {
  if (!text.startsWith(QR_PREFIX)) return null;
  const body = text.slice(QR_PREFIX.length);
  const dot = body.lastIndexOf('.');
  if (dot <= 0) return null;
  const orderId = body.slice(0, dot);
  const preimage = body.slice(dot + 1).toLowerCase();
  if (!/^[A-Za-z0-9-]{1,64}$/.test(orderId) || !HEX32.test(preimage)) return null;
  return { orderId, preimage };
}

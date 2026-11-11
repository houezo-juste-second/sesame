/**
 * Chiffrement des secrets au repos (sésame en attente, clés Nostr des boutiques) : AES-256-GCM.
 * Format : base64url( nonce 12 octets ‖ tag 16 octets ‖ texte chiffré ).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export class SecretBox {
  private readonly key: Buffer;

  /**
   * @param masterKey 64 caractères hexadécimaux (32 octets), ou toute chaîne secrète d'au moins
   *                  32 caractères (ex. valeur générée par l'hébergeur), dérivée par SHA-256.
   */
  constructor(masterKey: string) {
    if (/^[0-9a-fA-F]{64}$/.test(masterKey)) {
      this.key = Buffer.from(masterKey, 'hex');
    } else if (masterKey.length >= 32) {
      this.key = createHash('sha256').update(`sesame-master-key:${masterKey}`).digest();
    } else {
      throw new Error('SESAME_MASTER_KEY doit contenir 64 caractères hexadécimaux, ou une chaîne secrète d’au moins 32 caractères.');
    }
  }

  static random(): SecretBox {
    return new SecretBox(randomBytes(32).toString('hex'));
  }

  seal(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
  }

  open(sealed: string): string {
    const raw = Buffer.from(sealed, 'base64url');
    if (raw.length < 29) throw new Error('SECRETBOX_INVALID');
    const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  }
}

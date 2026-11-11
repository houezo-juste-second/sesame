/**
 * Jetons d'accès et codes PIN.
 * - Jetons : 128 bits aléatoires ; seul leur SHA-256 est stocké.
 * - PIN : scrypt + sel aléatoire, comparaison en temps constant.
 */
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pwd: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export type Role = 'seller' | 'client' | 'courier';

export interface Grant {
  role: Role;
  shopId: string;
  /** Absent pour la vendeuse (accès à toute sa boutique). */
  orderId?: string | undefined;
}

export function newToken(): string {
  return randomBytes(16).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class TokenStore {
  private readonly grants = new Map<string, Grant>();

  issue(grant: Grant): string {
    const token = newToken();
    this.grants.set(hashToken(token), grant);
    return token;
  }

  resolve(token: string | undefined): Grant | undefined {
    if (!token || token.length > 64) return undefined;
    return this.grants.get(hashToken(token));
  }
}

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pin, salt, 32);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scrypt(pin, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}

export function bearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const m = /^Bearer\s+([A-Za-z0-9_-]{1,64})$/.exec(header);
  return m?.[1];
}

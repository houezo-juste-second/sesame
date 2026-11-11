/**
 * Journal d'audit chaîné par hachage (EF-36) : hash = SHA-256(prevHash ‖ contenu canonique).
 * Toute modification ou suppression d'une entrée casse la chaîne.
 * Garde-fou : un secret ne peut jamais y être écrit.
 */
import { createHash } from 'node:crypto';

export type AuditValue = string | number | boolean | null;

export interface AuditInput {
  orderId: string;
  event: string;
  payload: Record<string, AuditValue>;
}

export interface AuditEntry extends AuditInput {
  seq: number;
  at: string;
  prevHash: string;
  hash: string;
}

export const GENESIS = '0'.repeat(64);
const FORBIDDEN_KEYS = /preimage|secret|token|macaroon|password|pin|nwc/i;
const FORBIDDEN_VALUES = /nostr\+walletconnect:|nsec1|^sesame:/i;

function canonical(e: Omit<AuditEntry, 'hash'>): string {
  const payload = Object.keys(e.payload)
    .sort()
    .map((k) => [k, e.payload[k]]);
  return JSON.stringify([e.seq, e.at, e.orderId, e.event, payload, e.prevHash]);
}

export function digest(e: Omit<AuditEntry, 'hash'>): string {
  return createHash('sha256').update(canonical(e)).digest('hex');
}

export function assertNoSecret(payload: Record<string, AuditValue>): void {
  for (const [k, v] of Object.entries(payload)) {
    if (FORBIDDEN_KEYS.test(k) || (typeof v === 'string' && FORBIDDEN_VALUES.test(v))) {
      throw new Error(`SECRET_IN_AUDIT: champ « ${k} » refusé`);
    }
  }
}

export class AuditLog {
  private readonly list: AuditEntry[] = [];

  constructor(private readonly clock: () => Date = () => new Date()) {}

  append(input: AuditInput): AuditEntry {
    assertNoSecret(input.payload);
    const prev = this.list.at(-1);
    const base = {
      seq: (prev?.seq ?? 0) + 1,
      at: this.clock().toISOString(),
      orderId: input.orderId,
      event: input.event,
      payload: { ...input.payload },
      prevHash: prev?.hash ?? GENESIS,
    };
    const entry: AuditEntry = { ...base, hash: digest(base) };
    this.list.push(entry);
    return structuredClone(entry);
  }

  entries(): AuditEntry[] {
    return structuredClone(this.list);
  }
}

export function verifyChain(entries: AuditEntry[]): { ok: true } | { ok: false; brokenAt: number } {
  let prevHash = GENESIS;
  let expectedSeq = 1;
  for (const e of entries) {
    const { hash, ...rest } = e;
    if (e.seq !== expectedSeq || e.prevHash !== prevHash || digest(rest) !== hash) {
      return { ok: false, brokenAt: e.seq };
    }
    prevHash = hash;
    expectedSeq += 1;
  }
  return { ok: true };
}

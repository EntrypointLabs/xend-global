import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

import { EntrySessionInvalidError } from './entry-session.errors';
import {
  ENTRY_SESSION_STORE,
  type EntrySessionStore,
} from './entry-session.store';
import type { Principal } from './principal';

const TOKEN_PREFIX = 'xentry_';
const TOKEN_BYTES = 32;

/**
 * Absolute, with no sliding window. Long enough to look around and start a
 * recovery; short enough that a token lifted from a phone that was put down
 * is worth little. Nothing an entry session does needs to outlive an hour.
 */
export const ENTRY_SESSION_TTL_MS = 60 * 60 * 1000;

/**
 * The limited session an email code opens on an Account that already exists.
 *
 * Our own credential with nothing behind it: no Privy session, no signer.
 * The token is opaque and hashed at rest, so validating one is a lookup and
 * revoking one is a row update, and a leaked row exposes only a hash.
 */
@Injectable()
export class EntrySessionService {
  private readonly logger = new Logger(EntrySessionService.name);

  constructor(
    @Inject(ENTRY_SESSION_STORE) private readonly store: EntrySessionStore,
  ) {}

  /** Whether a bearer value is one of ours, before anything is looked up. */
  static isEntryToken(raw: string): boolean {
    return raw.startsWith(TOKEN_PREFIX);
  }

  async open(
    userId: string,
    now = new Date(),
  ): Promise<{ entryToken: string; expiresAt: string }> {
    const raw = `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('base64url')}`;
    const row = await this.store.insert({
      userId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(now.getTime() + ENTRY_SESSION_TTL_MS),
    });
    this.logger.log(`entry.opened user=${userId}`);
    return { entryToken: raw, expiresAt: row.expiresAt.toISOString() };
  }

  /** The principal a presented token stands for, or a refusal. */
  async authenticate(raw: string, now = new Date()): Promise<Principal> {
    if (!EntrySessionService.isEntryToken(raw)) {
      throw new EntrySessionInvalidError('that session is not valid');
    }
    const live = await this.store.findLive(hashToken(raw), now);
    if (!live) {
      throw new EntrySessionInvalidError('that session is not valid');
    }
    return {
      userId: live.userId,
      walletAddress: live.walletAddress,
      tier: 'entry',
      entrySessionId: live.session.id,
    };
  }

  async revoke(sessionId: string, now = new Date()): Promise<void> {
    await this.store.revoke(sessionId, now);
    this.logger.log(`entry.revoked session=${sessionId}`);
  }
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

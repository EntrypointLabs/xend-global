/**
 * How much a session may do.
 *
 * `full` is a passkey-backed session from `auth/exchange`. `entry` is what an
 * email code opens on an Account that already exists: it can look and can
 * start a recovery, and nothing else. The tier lives on the principal so the
 * check is made against the credential that was presented, never against
 * which buttons the app chose to show.
 */
export type SessionTier = 'full' | 'entry';

export interface Principal {
  userId: string;
  walletAddress: string;
  tier: SessionTier;
  /** The row behind an entry session, so signing out can revoke exactly it. */
  entrySessionId?: string;
}

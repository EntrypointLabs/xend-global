/*
 * What a controller spec needs to put the real ConsumerAuthGuard in front of
 * its routes over HTTP. Both credentials are stood in for at the boundary the
 * guard calls, so the tier check a route gets under test is the one it gets
 * in production and not a copy of it.
 */
import {
  UnauthorizedException,
  type ExecutionContext,
  type Provider,
} from '@nestjs/common';
import type { Request } from 'express';
import { EntrySessionService } from './entry-session.service';
import type { Principal } from './principal';

const FULL_PREFIX = 'passkey.';
const ENTRY_PREFIX = 'xentry_';

/** `Authorization` for a passkey-backed session belonging to `userId`. */
export const fullSession = (userId = 'alice') =>
  `Bearer ${FULL_PREFIX}${userId}`;

/** `Authorization` for the email-only session belonging to `userId`. */
export const entrySession = (userId = 'alice') =>
  `Bearer ${ENTRY_PREFIX}${userId}`;

export const walletOf = (userId: string) => `wallet-of-${userId}`;

/** The guard's own dependency, answering for any entry token made above. */
export function consumerSessionProviders(): Provider[] {
  return [
    {
      provide: EntrySessionService,
      useValue: {
        authenticate: (raw: string): Promise<Principal> => {
          const userId = raw.slice(ENTRY_PREFIX.length);
          return Promise.resolve({
            userId,
            walletAddress: walletOf(userId),
            tier: 'entry',
            entrySessionId: `entry-${userId}`,
          });
        },
      },
    },
  ];
}

/**
 * Stands in for the JWT half, which is passport's and has its own spec. A
 * spec installs it with
 * `jest.spyOn(AuthGuard('jwt').prototype, 'canActivate')`.
 */
export function authenticatePasskeySession(
  context: ExecutionContext,
): Promise<boolean> {
  const request = context
    .switchToHttp()
    .getRequest<Request & { user?: Principal }>();
  const [, token] = (request.headers.authorization ?? '').split(' ');
  if (!token?.startsWith(FULL_PREFIX)) throw new UnauthorizedException();
  const userId = token.slice(FULL_PREFIX.length);
  request.user = { userId, walletAddress: walletOf(userId), tier: 'full' };
  return Promise.resolve(true);
}

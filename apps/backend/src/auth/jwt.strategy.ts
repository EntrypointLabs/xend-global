import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { smartAccounts, users } from '../db/schema';
import { parseJwtKeyRing, secretForToken } from './jwt-secrets';
import type { Principal } from './principal';

/**
 * JWT payload shape. The JWT identifies the user (`sub`) and pins the
 * wallet address the client should use for the duration of the session,
 * so subsequent /wallet/me, /transfers/*, etc. calls do not need a DB
 * lookup just to resolve the address.
 */
export interface JwtPayload {
  sub: string; // userId
  walletAddress: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private db: DbService,
  ) {
    const ring = parseJwtKeyRing(config);
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKeyProvider: (
        _request: unknown,
        rawToken: string,
        done: (err: Error | null, secret?: string) => void,
      ) => {
        try {
          done(null, secretForToken(ring, rawToken));
        } catch (err) {
          done(err as Error);
        }
      },
    });
  }

  /**
   * This gets attached to req.user on every protected route. JWTs live for
   * days (JWT_EXPIRES_IN), far longer than an account-deletion request
   * should stay honored, so a live DB check against `deletedAt` — not just
   * the token's own signature/expiry — is what actually locks a deleted
   * account out immediately.
   */
  async validate(payload: JwtPayload): Promise<Principal> {
    const [user] = await this.db.client
      .select({
        deletedAt: users.deletedAt,
        walletAddress: smartAccounts.walletAddress,
      })
      .from(users)
      .leftJoin(smartAccounts, eq(smartAccounts.userId, users.id))
      .where(eq(users.id, payload.sub))
      .limit(1);

    if (!user || user.deletedAt) {
      throw new UnauthorizedException();
    }

    // A passkey replacement retires the old wallet, and every token minted
    // behind the old passkey names it. Rejecting the mismatch is what ends a
    // stale or stolen session at the rotation instead of at the token expiry.
    if (user.walletAddress && user.walletAddress !== payload.walletAddress) {
      throw new UnauthorizedException();
    }

    // A JWT is only ever minted by the exchange, behind a passkey, so it is
    // the full tier by construction.
    return {
      userId: payload.sub,
      walletAddress: payload.walletAddress,
      tier: 'full',
    };
  }
}

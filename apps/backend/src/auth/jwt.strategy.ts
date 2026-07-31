import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { users } from '../db/schema';

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
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow('JWT_SECRET'),
    });
  }

  /**
   * This gets attached to req.user on every protected route. JWTs live for
   * days (JWT_EXPIRES_IN), far longer than an account-deletion request
   * should stay honored, so a live DB check against `deletedAt` — not just
   * the token's own signature/expiry — is what actually locks a deleted
   * account out immediately.
   */
  async validate(payload: JwtPayload) {
    const [user] = await this.db.client
      .select({ deletedAt: users.deletedAt })
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1);

    if (!user || user.deletedAt) {
      throw new UnauthorizedException();
    }

    return { userId: payload.sub, walletAddress: payload.walletAddress };
  }
}

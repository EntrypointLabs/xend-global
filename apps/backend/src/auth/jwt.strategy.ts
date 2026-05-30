import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

/**
 * JWT payload shape.
 *
 * Phase 1 rename: `gridAccountId` -> `walletAddress`. Per spec §5.1
 * the JWT identifies the user (`sub`) and pins the wallet address the
 * client should use for the duration of the session, so subsequent
 * /wallet/me, /transfers/*, etc. calls do not need a DB lookup just to
 * resolve the address.
 *
 * Old tokens signed with the `gridAccountId` claim become invalid after
 * this rename. The mobile app re-issues a token on next sign-in (via
 * the still-alive Grid-shaped /verify-otp* endpoints in this phase; via
 * /auth/exchange after Phase 4 mobile cutover).
 */
export interface JwtPayload {
  sub: string; // userId
  walletAddress: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow('JWT_SECRET'),
    });
  }

  validate(payload: JwtPayload) {
    // This gets attached to req.user on every protected route.
    return { userId: payload.sub, walletAddress: payload.walletAddress };
  }
}

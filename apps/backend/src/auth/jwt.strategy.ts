import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

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

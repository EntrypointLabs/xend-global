import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

export interface JwtPayload {
    sub: string;           // userId
    gridAccountId: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(config: ConfigService) {
        super({
            jwtFromRequest:   ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey:      config.getOrThrow('JWT_SECRET'),
        });
    }

    validate(payload: JwtPayload) {
        // This gets attached to req.user on every protected route
        return { userId: payload.sub, gridAccountId: payload.gridAccountId };
    }
}
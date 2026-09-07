import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/**
 * METRICS_SECRET set: the scrape must carry it as a bearer token. Unset: open
 * outside production (local Prometheus, curl), and absent altogether in
 * production, where an unauthenticated scrape endpoint would leak route and
 * volume data to anyone who finds it.
 */
@Injectable()
export class MetricsAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = this.config.get<string>('METRICS_SECRET') ?? '';
    if (!secret) {
      if (this.config.get<string>('NODE_ENV') === 'production') {
        throw new NotFoundException();
      }
      return true;
    }
    const auth = context.switchToHttp().getRequest<Request>()
      .headers.authorization;
    const presented =
      typeof auth === 'string' && auth.startsWith('Bearer ')
        ? auth.slice('Bearer '.length).trim()
        : '';
    const a = createHash('sha256').update(presented).digest();
    const b = createHash('sha256').update(secret).digest();
    if (!presented || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException({
        code: 'INVALID_METRICS_SECRET',
        message: 'metrics require the METRICS_SECRET bearer token',
      });
    }
    return true;
  }
}

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';

export const TEST_DASHBOARD_SECRET_HEADER = 'x-test-dashboard-secret';

/**
 * Dev-only gate for the local test dashboard. The dashboard mints Merchant
 * API keys with no auth, so it is a local testing aid only and must never
 * exist in production: unless NODE_ENV is exactly 'development' AND the
 * request carries the configured TEST_DASHBOARD_SECRET on
 * x-test-dashboard-secret, every route 404s as if the dashboard were never
 * registered. An unset secret disables the dashboard outright.
 */
@Injectable()
export class TestDashboardGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.config.get<string>('NODE_ENV') !== 'development') {
      throw new NotFoundException();
    }
    const expected = this.config.get<string>('TEST_DASHBOARD_SECRET') ?? '';
    if (!expected) {
      throw new NotFoundException();
    }
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers[TEST_DASHBOARD_SECRET_HEADER];
    const supplied = Array.isArray(header) ? header[0] : header;
    if (!supplied || !this.matches(supplied, expected)) {
      throw new NotFoundException();
    }
    return true;
  }

  private matches(supplied: string, expected: string): boolean {
    const a = createHash('sha256').update(supplied).digest();
    const b = createHash('sha256').update(expected).digest();
    return timingSafeEqual(a, b);
  }
}

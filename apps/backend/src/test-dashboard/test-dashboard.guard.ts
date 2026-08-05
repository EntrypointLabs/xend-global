import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Dev-only gate for the local test dashboard. The dashboard mints Merchant
 * API keys with no auth, so it is a local testing aid only and must never
 * exist in production: unless NODE_ENV is exactly 'development', every route
 * 404s as if the dashboard were never registered.
 */
@Injectable()
export class TestDashboardGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(): boolean {
    if (this.config.get<string>('NODE_ENV') !== 'development') {
      throw new NotFoundException();
    }
    return true;
  }
}

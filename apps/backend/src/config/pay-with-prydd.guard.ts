import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { payWithPryddEnabled } from './pay-with-prydd';

/**
 * Refuses routes that create or move Payments while Pay with Prydd is off.
 * The jobs that settle, expire and retry a Payment only run with the flag on,
 * so a Payment accepted without it would be stranded.
 */
@Injectable()
export class PayWithPryddEnabledGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(): boolean {
    if (!payWithPryddEnabled(this.config)) {
      throw new NotFoundException({
        code: 'PAY_WITH_PRYDD_DISABLED',
        message: 'Pay with Prydd is not available',
      });
    }
    return true;
  }
}

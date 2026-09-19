import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrivyAdapter } from '../wallet/privy.adapter';

/** Merchant tokens must never fall back to the Consumer Privy application. */
@Injectable()
export class MerchantIdentityService {
  private adapter?: PrivyAdapter;

  constructor(private readonly config: ConfigService) {}

  verifyIdToken(token: string) {
    if (!this.adapter) {
      const appId = this.config.get<string>('MERCHANT_PRIVY_APP_ID');
      const secret = this.config.get<string>('MERCHANT_PRIVY_APP_SECRET');
      if (
        !appId ||
        !secret ||
        appId === this.config.get<string>('PRIVY_APP_ID')
      )
        throw new ServiceUnavailableException(
          'Merchant authentication is not configured',
        );
      const adapter = new PrivyAdapter(
        new ConfigService({
          PRIVY_APP_ID: appId,
          PRIVY_APP_SECRET: secret,
          NODE_ENV: this.config.get<string>('NODE_ENV'),
        }),
      );
      adapter.onModuleInit();
      this.adapter = adapter;
    }
    return this.adapter.verifyIdToken(token, { requireWallet: true });
  }
}

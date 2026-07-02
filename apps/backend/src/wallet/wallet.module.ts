import { Module } from '@nestjs/common';
import { PrivyAdapter } from './privy.adapter';
import { WALLET_PROVIDER } from './wallet-provider.interface';

/**
 * Exposes the WalletProvider seam via `WALLET_PROVIDER`, bound to
 * PrivyAdapter. Swapping to TurnkeyAdapter or CrossmintAdapter later is a
 * single edit here (plus an env-var rotation), with no other module
 * changing.
 */
@Module({
  providers: [
    PrivyAdapter,
    {
      provide: WALLET_PROVIDER,
      useExisting: PrivyAdapter,
    },
  ],
  exports: [WALLET_PROVIDER],
})
export class WalletModule {}

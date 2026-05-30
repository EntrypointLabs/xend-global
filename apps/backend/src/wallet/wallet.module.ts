import { Module } from '@nestjs/common';
import { PrivyAdapter } from './privy.adapter';
import { WALLET_PROVIDER } from './wallet-provider.interface';

/**
 * WalletModule — exposes the WalletProvider seam via `WALLET_PROVIDER`.
 *
 * In v1 the binding is PrivyAdapter. Swapping to TurnkeyAdapter or
 * CrossmintAdapter later is a single edit here (and an env-var rotation),
 * with no other module changing.
 *
 * In Phase 0 the adapter is a stub that throws on every method; nothing
 * consumes `WALLET_PROVIDER` yet, so DI registration is the entire point
 * of this module today.
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

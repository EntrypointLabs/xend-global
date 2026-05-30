import { Module } from '@nestjs/common';
import { KYC_PROVIDER } from './kyc-provider.interface';
import { SumsubAdapter } from './sumsub.adapter';

/**
 * KycModule — exposes the KycProvider seam via `KYC_PROVIDER`.
 *
 * In v1 the binding is SumsubAdapter, replacing the Grid+Bridge coupling.
 * Swapping vendors later is a single edit here.
 *
 * In Phase 0 the adapter is a stub that throws on every method; nothing
 * consumes `KYC_PROVIDER` yet, so DI registration is the entire point of
 * this module today.
 */
@Module({
  providers: [
    SumsubAdapter,
    {
      provide: KYC_PROVIDER,
      useExisting: SumsubAdapter,
    },
  ],
  exports: [KYC_PROVIDER],
})
export class KycModule {}

import { Module } from '@nestjs/common';
import { KYC_PROVIDER } from './kyc-provider.interface';
import { SumsubAdapter } from './sumsub.adapter';

/**
 * Exposes the KycProvider seam via `KYC_PROVIDER`, bound to SumsubAdapter.
 * Swapping vendors later is a single edit here.
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

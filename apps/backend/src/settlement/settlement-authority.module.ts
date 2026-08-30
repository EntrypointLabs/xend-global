import { Module } from '@nestjs/common';
import { SolanaModule } from '../solana/solana.module';
import { SETTLEMENT_AUTHORITY_SIGNER } from './settlement-authority.interface';
import { SettlementAuthorityEnvSigner } from './settlement-authority.env-signer';

/**
 * The settlement authority, bound on its own.
 *
 * A Payment leaves the same vault a Send does, so the settlement layer has to
 * reach the Spend path, and the Spend path has to reach the authority that pays
 * its fees. Binding the signer in its own module is what keeps that from being
 * a cycle between the two.
 */
@Module({
  imports: [SolanaModule],
  providers: [
    SettlementAuthorityEnvSigner,
    {
      provide: SETTLEMENT_AUTHORITY_SIGNER,
      useExisting: SettlementAuthorityEnvSigner,
    },
  ],
  exports: [SETTLEMENT_AUTHORITY_SIGNER],
})
export class SettlementAuthorityModule {}

import { Module } from '@nestjs/common';
import { SolanaModule } from '../solana/solana.module';
import { SETTLEMENT_AUTHORITY_SIGNER } from './settlement-authority.interface';
import { SettlementAuthorityEnvSigner } from './settlement-authority.env-signer';
import { DirectUsdcProvider } from './providers/direct-usdc.provider';
import { SETTLEMENT_PROVIDERS } from './settlement-provider.interface';
import { SettlementRouter } from './settlement-router';
import { SettlementProvisioningService } from './settlement-provisioning.service';

/**
 * Settlement provider layer (ADR 0015). SETTLEMENT_PROVIDERS is an array
 * holding exactly the direct-USDC adapter at pilot; Phase 8 appends the
 * Blockradar adapter to this factory (the plug point), not a new token.
 */
@Module({
  imports: [SolanaModule],
  providers: [
    SettlementAuthorityEnvSigner,
    {
      provide: SETTLEMENT_AUTHORITY_SIGNER,
      useExisting: SettlementAuthorityEnvSigner,
    },
    DirectUsdcProvider,
    {
      provide: SETTLEMENT_PROVIDERS,
      useFactory: (directUsdc: DirectUsdcProvider) => [directUsdc],
      inject: [DirectUsdcProvider],
    },
    SettlementRouter,
    SettlementProvisioningService,
  ],
  exports: [SettlementProvisioningService, SettlementRouter],
})
export class SettlementModule {}

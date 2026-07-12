import { Module } from '@nestjs/common';
import { SolanaModule } from '../solana/solana.module';
import { PaymentModule } from '../payment/payment.module';
import { EventsModule } from '../events/events.module';
import { SETTLEMENT_AUTHORITY_SIGNER } from './settlement-authority.interface';
import { SettlementAuthorityEnvSigner } from './settlement-authority.env-signer';
import { DirectUsdcProvider } from './providers/direct-usdc.provider';
import { SETTLEMENT_PROVIDERS } from './settlement-provider.interface';
import { SettlementRouter } from './settlement-router';
import { SettlementProvisioningService } from './settlement-provisioning.service';
import { RelayerClient } from './relayer.client';
import { SettlementService } from './settlement.service';
import { SettlementConfirmationService } from './settlement-confirmation.service';

/**
 * Settlement provider layer (ADR 0015). SETTLEMENT_PROVIDERS is an array
 * holding exactly the direct-USDC adapter at pilot; Phase 8 appends the
 * Blockradar adapter to this factory (the plug point), not a new token.
 */
@Module({
  imports: [SolanaModule, PaymentModule, EventsModule],
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
    RelayerClient,
    SettlementService,
    SettlementConfirmationService,
  ],
  exports: [
    SettlementProvisioningService,
    SettlementRouter,
    SettlementService,
    SettlementConfirmationService,
  ],
})
export class SettlementModule {}

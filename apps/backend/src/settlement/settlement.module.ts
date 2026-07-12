import { Module } from '@nestjs/common';
import { SolanaModule } from '../solana/solana.module';
import { PaymentModule } from '../payment/payment.module';
import { EventsModule } from '../events/events.module';
import { SETTLEMENT_AUTHORITY_SIGNER } from './settlement-authority.interface';
import { SettlementAuthorityEnvSigner } from './settlement-authority.env-signer';
import { DirectUsdcProvider } from './providers/direct-usdc.provider';
import { BlockradarSettlementModule } from './providers/blockradar/blockradar-settlement.module';
import { BlockradarSettlementProvider } from './providers/blockradar/blockradar-settlement.provider';
import { BlockradarWebhookController } from './providers/blockradar/blockradar-webhook.controller';
import { SETTLEMENT_PROVIDERS } from './settlement-provider.interface';
import { SettlementRouter } from './settlement-router';
import { SettlementProvisioningService } from './settlement-provisioning.service';
import { RelayerClient } from './relayer.client';
import { SettlementService } from './settlement.service';
import { SettlementConfirmationService } from './settlement-confirmation.service';

/**
 * Settlement provider layer (ADR 0015). SETTLEMENT_PROVIDERS is an array of
 * adapters: the direct-USDC pilot adapter plus the Blockradar naira adapter
 * (Phase 8, ADR 0019), appended to this factory (the plug point) — not a new
 * token. The Blockradar off-ramp webhook controller is registered here (rather
 * than in the Blockradar submodule) so it can reach completeDeferredSettlement
 * without a module cycle.
 */
@Module({
  imports: [
    SolanaModule,
    PaymentModule,
    EventsModule,
    BlockradarSettlementModule,
  ],
  controllers: [BlockradarWebhookController],
  providers: [
    SettlementAuthorityEnvSigner,
    {
      provide: SETTLEMENT_AUTHORITY_SIGNER,
      useExisting: SettlementAuthorityEnvSigner,
    },
    DirectUsdcProvider,
    {
      provide: SETTLEMENT_PROVIDERS,
      useFactory: (
        directUsdc: DirectUsdcProvider,
        blockradar: BlockradarSettlementProvider,
      ) => [directUsdc, blockradar],
      inject: [DirectUsdcProvider, BlockradarSettlementProvider],
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

import { Module } from '@nestjs/common';
import { SolanaModule } from '../solana/solana.module';
import { PaymentModule } from '../payment/payment.module';
import { EventsModule } from '../events/events.module';
import { SpendModule } from '../account/spend.module';
import { SettlementAuthorityModule } from './settlement-authority.module';
import { DirectUsdcProvider } from './providers/direct-usdc.provider';
import { BlockradarSettlementModule } from './providers/blockradar/blockradar-settlement.module';
import { BlockradarSettlementProvider } from './providers/blockradar/blockradar-settlement.provider';
import { BlockradarWebhookController } from './providers/blockradar/blockradar-webhook.controller';
import { OfframpReconcilerService } from './providers/blockradar/offramp-reconciler.service';
import { SETTLEMENT_PROVIDERS } from './settlement-provider.interface';
import { SettlementRouter } from './settlement-router';
import { SettlementProvisioningService } from './settlement-provisioning.service';
import { RelayerClient } from './relayer.client';
import { SettlementService } from './settlement.service';
import { SettlementConfirmationService } from './settlement-confirmation.service';

/**
 * Read from the raw environment because module metadata is evaluated at
 * import time, before any ConfigService exists. Joi validates the same value.
 */
const blockradarWebhookEnabled = /^(true|1|yes)$/i.test(
  process.env.BLOCKRADAR_SOLANA_NATIVE_ENABLED ?? '',
);

/**
 * Settlement provider layer (ADR 0015). SETTLEMENT_PROVIDERS is an array of
 * adapters: the direct-USDC pilot adapter plus the Blockradar naira adapter
 * (Phase 8, ADR 0019), appended to this factory (the plug point) — not a new
 * token. The Blockradar off-ramp webhook controller is registered here (rather
 * than in the Blockradar submodule) so it can reach completeDeferredSettlement
 * without a module cycle, and only when the naira leg is enabled: an
 * unmounted receiver cannot be reached with a missing secret.
 */
@Module({
  imports: [
    SolanaModule,
    PaymentModule,
    EventsModule,
    BlockradarSettlementModule,
    SettlementAuthorityModule,
    SpendModule,
  ],
  controllers: blockradarWebhookEnabled ? [BlockradarWebhookController] : [],
  providers: [
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
    OfframpReconcilerService,
  ],
  exports: [
    SettlementProvisioningService,
    SettlementRouter,
    SettlementService,
    SettlementConfirmationService,
    // Account creation pays its rent with the authority rather than the
    // relayer, whose allowlist excludes the System program by design.
    SettlementAuthorityModule,
  ],
})
export class SettlementModule {}

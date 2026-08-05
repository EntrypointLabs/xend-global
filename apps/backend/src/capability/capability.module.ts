import { Module } from '@nestjs/common';
import { SolanaModule } from '../solana/solana.module';
import { WalletModule } from '../wallet/wallet.module';
import { EventsModule } from '../events/events.module';
import { CountersModule } from '../counters/counters.module';
import { PaymentModule } from '../payment/payment.module';
import { SessionModule } from '../session/session.module';
import { CapacityService } from './capacity.service';
import { IdentityService } from './identity.service';
import { PaymentAuthorizationService } from './payment-authorization.service';

/**
 * The Identity and Capability engine. RATE_COUNTER comes from the shared
 * CountersModule (not bound here) so SessionModule can reuse the same seam
 * without a Capability<->Session cycle. The Capability -> Session import is
 * one-directional (Session never imports Capability), so the graph stays
 * acyclic with no circular-dependency workaround.
 */
@Module({
  imports: [
    SolanaModule,
    WalletModule,
    EventsModule,
    CountersModule,
    PaymentModule,
    SessionModule,
  ],
  providers: [CapacityService, IdentityService, PaymentAuthorizationService],
  exports: [CapacityService, IdentityService, PaymentAuthorizationService],
})
export class CapabilityModule {}

import { Module } from '@nestjs/common';
import { CapabilityModule } from '../capability/capability.module';
import { SettlementModule } from '../settlement/settlement.module';
import { PendingPaymentController } from './pending-payment.controller';
import { PaymentModule } from './payment.module';

/**
 * The app's half of a Payment too large for Checkout to finish.
 *
 * Its own module rather than a controller on PaymentModule: both Capability and
 * Settlement already import PaymentModule, so hanging this off it would make
 * the graph circular. Nothing imports this one.
 */
@Module({
  imports: [PaymentModule, CapabilityModule, SettlementModule],
  controllers: [PendingPaymentController],
})
export class PendingPaymentModule {}

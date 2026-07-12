import { Module } from '@nestjs/common';
import { EventsModule } from '../../../events/events.module';
import { BlockradarSettlementProvider } from './blockradar-settlement.provider';

/**
 * The Blockradar adapter as a pure provider module (ADR 0019). SettlementModule
 * imports this to APPEND BlockradarSettlementProvider to the SETTLEMENT_PROVIDERS
 * factory array, and registers the off-ramp webhook controller itself (so the
 * controller can reach completeDeferredSettlement without a module cycle).
 * DbService comes from the global DbModule; EVENT_PUBLISHER from EventsModule.
 */
@Module({
  imports: [EventsModule],
  providers: [BlockradarSettlementProvider],
  exports: [BlockradarSettlementProvider],
})
export class BlockradarSettlementModule {}

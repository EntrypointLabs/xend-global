import { Module } from '@nestjs/common';
import { SolanaModule } from '../solana/solana.module';
import { CountersModule } from '../counters/counters.module';
import { CapacityService } from './capacity.service';

/**
 * The Identity and Capability engine. RATE_COUNTER comes from the shared
 * CountersModule (not bound here) so SessionModule can reuse the same seam
 * without a Capability<->Session cycle.
 */
@Module({
  imports: [SolanaModule, CountersModule],
  providers: [CapacityService],
  exports: [CapacityService],
})
export class CapabilityModule {}

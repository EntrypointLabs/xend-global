import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { CAPACITY_COUNTER, RATE_COUNTER } from './rate-counter.interface';
import { PostgresCapacityCounter } from './postgres-capacity-counter';
import { RedisRateCounter } from './redis-rate-counter';

/**
 * Shared binding for the RATE_COUNTER seam. Both CapabilityModule and
 * SessionModule import this module, so neither imports the other and the
 * module graph stays acyclic with no forwardRef. CAPACITY_COUNTER is the
 * transactional PostgreSQL counter so authorization and capacity commit together.
 */
@Module({
  imports: [RedisModule],
  providers: [
    RedisRateCounter,
    PostgresCapacityCounter,
    { provide: RATE_COUNTER, useExisting: RedisRateCounter },
    { provide: CAPACITY_COUNTER, useExisting: PostgresCapacityCounter },
  ],
  exports: [RATE_COUNTER, CAPACITY_COUNTER],
})
export class CountersModule {}

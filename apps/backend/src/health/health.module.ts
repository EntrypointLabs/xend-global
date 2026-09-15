import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { HealthController } from './health.controller';

/** GET /health: DbService comes from the global DbModule. */
@Module({
  imports: [RedisModule],
  controllers: [HealthController],
})
export class HealthModule {}

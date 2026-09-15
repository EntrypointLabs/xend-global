import { Module } from '@nestjs/common';

import { RedisModule } from '../redis/redis.module';
import { PREPARED_TX_STORE } from './prepared-tx.interface';
import { RedisPreparedTxStore } from './prepared-tx.redis';

@Module({
  imports: [RedisModule],
  providers: [{ provide: PREPARED_TX_STORE, useClass: RedisPreparedTxStore }],
  exports: [PREPARED_TX_STORE],
})
export class PreparedModule {}

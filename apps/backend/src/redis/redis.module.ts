import {
  Inject,
  Logger,
  Module,
  OnApplicationShutdown,
  Provider,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

/**
 * Single ioredis client bound behind REDIS_CLIENT, the DI-token seam that
 * keeps ioredis out of the rest of the app (Grid-incident rule, ADR 0010).
 * Phase 2 consumes this for Session state and rate-limit counters.
 */
const redisClientProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: (config: ConfigService) => {
    const logger = new Logger('RedisModule');
    const client = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: 2,
    });
    client.on('ready', () => logger.log('redis.connect status=ready'));
    client.on('error', (err: Error) =>
      logger.error(`redis.error message=${err.message}`),
    );
    return client;
  },
  inject: [ConfigService],
};

@Module({ providers: [redisClientProvider], exports: [REDIS_CLIENT] })
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async onApplicationShutdown() {
    await this.client.quit();
  }
}

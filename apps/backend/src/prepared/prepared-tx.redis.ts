import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';

import { REDIS_CLIENT } from '../redis/redis.constants';
import type { PreparedTxStore } from './prepared-tx.interface';

@Injectable()
export class RedisPreparedTxStore implements PreparedTxStore {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.redis.set(
      namespaced(key),
      JSON.stringify(value),
      'EX',
      ttlSeconds,
    );
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(namespaced(key));
    return raw === null ? null : (JSON.parse(raw) as T);
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(namespaced(key));
  }
}

function namespaced(key: string): string {
  return `prepared:${key}`;
}

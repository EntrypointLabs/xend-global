import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import type { CounterSnapshot, RateCounter } from './rate-counter.interface';

/**
 * Redis-backed RateCounter. This is the ONLY business-side importer of
 * REDIS_CLIENT for velocity/limit counters (ADR 0010 owned-interface rule);
 * everything else reaches counters through the RATE_COUNTER seam.
 *
 * Each window is two keys: `<key>:count` (INCR) and `<key>:amount` (INCRBY).
 * INCRBY replies are exact integers below 2^53 raw units (over nine billion
 * USDC in minor units), far beyond any tier cap, so String(reply) is a
 * lossless total.
 */
@Injectable()
export class RedisRateCounter implements RateCounter {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async increment(
    key: string,
    amountRaw: string,
    ttlSeconds: number,
  ): Promise<CounterSnapshot> {
    const countKey = `${key}:count`;
    const amountKey = `${key}:amount`;
    // NX on EXPIRE pins the window to first-write, so the TTL is the window
    // length and does not slide forward on every increment.
    const replies = await this.redis
      .multi()
      .incr(countKey)
      .incrby(amountKey, amountRaw)
      .expire(countKey, ttlSeconds, 'NX')
      .expire(amountKey, ttlSeconds, 'NX')
      .exec();
    if (!replies) {
      throw new Error('rate counter pipeline returned no replies');
    }
    const count = replies[0][1] as number;
    const totalRaw = String(replies[1][1]);
    return { count, totalRaw };
  }

  async peek(key: string): Promise<CounterSnapshot> {
    const [countReply, amountReply] = await this.redis.mget(
      `${key}:count`,
      `${key}:amount`,
    );
    return {
      count: countReply ? parseInt(countReply, 10) : 0,
      totalRaw: amountReply ?? '0',
    };
  }

  async clear(key: string): Promise<void> {
    await this.redis.del(`${key}:count`, `${key}:amount`);
  }
}

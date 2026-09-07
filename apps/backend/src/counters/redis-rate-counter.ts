import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import type {
  CounterSnapshot,
  ReservationResult,
  ReservingRateCounter,
} from './rate-counter.interface';

/**
 * KEYS[1] = count key, KEYS[2] = amount key.
 * ARGV[1] = amount, ARGV[2] = cap, ARGV[3] = ttl seconds.
 * Replies [allowed, count, total]. Runs atomically on the server, which is
 * what makes increment-then-check safe under concurrent callers.
 */
const RESERVE_SCRIPT = `
local total = redis.call('INCRBY', KEYS[2], ARGV[1])
if total > tonumber(ARGV[2]) then
  total = redis.call('DECRBY', KEYS[2], ARGV[1])
  local count = tonumber(redis.call('GET', KEYS[1]) or '0')
  return {0, count, total}
end
local count = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[3], 'NX')
redis.call('EXPIRE', KEYS[2], ARGV[3], 'NX')
return {1, count, total}
`;

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
export class RedisRateCounter implements ReservingRateCounter {
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

  async reserve(
    key: string,
    amountRaw: string,
    capRaw: string,
    ttlSeconds: number,
  ): Promise<ReservationResult> {
    const reply = (await this.redis.eval(
      RESERVE_SCRIPT,
      2,
      `${key}:count`,
      `${key}:amount`,
      amountRaw,
      capRaw,
      ttlSeconds,
    )) as [number, number, number];
    return {
      allowed: reply[0] === 1,
      snapshot: { count: reply[1], totalRaw: String(reply[2]) },
    };
  }

  async release(key: string, amountRaw: string): Promise<void> {
    await this.redis
      .multi()
      .decrby(`${key}:amount`, amountRaw)
      .decr(`${key}:count`)
      .exec();
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

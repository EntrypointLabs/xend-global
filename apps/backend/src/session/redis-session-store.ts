import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import type { SessionStore } from './session-store.interface';

/**
 * Redis-backed SessionStore. Sole business-side importer of REDIS_CLIENT for
 * session sliding-activity state (ADR 0010 owned-interface rule). The key is
 * a presence marker whose TTL is the sliding window; expiry is the answer to
 * "was this Session used recently", with Postgres last_used_at as the
 * durable fallback.
 */
@Injectable()
export class RedisSessionStore implements SessionStore {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async touch(sessionId: string, windowSeconds: number): Promise<void> {
    await this.redis.set(this.key(sessionId), '1', 'EX', windowSeconds);
  }

  async isActive(sessionId: string): Promise<boolean> {
    return (await this.redis.exists(this.key(sessionId))) === 1;
  }

  async clear(sessionId: string): Promise<void> {
    await this.redis.del(this.key(sessionId));
  }

  private key(sessionId: string): string {
    return `session:active:${sessionId}`;
  }
}

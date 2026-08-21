import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type Redis from 'ioredis';

import { REDIS_CLIENT } from '../redis/redis.constants';
import type { AttestationNonceStore } from './attestation.interface';

/**
 * Short enough that a captured nonce is not worth carrying to another machine,
 * long enough for a biometric prompt on a cold app start.
 */
const TTL_SECONDS = 120;

@Injectable()
export class RedisAttestationNonceStore implements AttestationNonceStore {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async issue(userId: string): Promise<string> {
    const nonce = randomBytes(32).toString('base64url');
    await this.redis.set(key(userId, nonce), '1', 'EX', TTL_SECONDS);
    return nonce;
  }

  /**
   * DEL returns the number of keys removed, so the delete is the check. Reading
   * and then deleting would let two concurrent requests both see the nonce and
   * both proceed, which is exactly the replay this is here to stop.
   */
  async consume(userId: string, nonce: string): Promise<boolean> {
    if (!nonce) return false;
    const removed = await this.redis.del(key(userId, nonce));
    return removed === 1;
  }
}

/** Keyed by user as well as nonce, so one user's nonce cannot enrol another. */
function key(userId: string, nonce: string): string {
  return `attestation:nonce:${userId}:${nonce}`;
}

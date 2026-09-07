import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { DbService } from '../db/db.service';
import { REDIS_CLIENT } from '../redis/redis.constants';

const CHECK_TIMEOUT_MS = 3000;

type CheckStatus = 'ok' | 'fail';

export interface HealthReport {
  status: CheckStatus;
  checks: { db: CheckStatus; redis: CheckStatus };
}

function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${CHECK_TIMEOUT_MS}ms`)),
      CHECK_TIMEOUT_MS,
    );
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Liveness for the load balancer: unauthenticated, exempt from throttling
 * (a probe that trips the rate limit would take a healthy instance out of
 * rotation), and 503 the moment Postgres or Redis stops answering.
 */
@Controller('health')
@SkipThrottle()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly db: DbService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get()
  async check(): Promise<HealthReport> {
    const [db, redis] = await Promise.all([
      this.probe('db', () => this.db.ping(CHECK_TIMEOUT_MS)),
      this.probe('redis', async () => {
        await withTimeout(this.redis.ping(), 'redis ping');
      }),
    ]);
    const report: HealthReport = {
      status: db === 'ok' && redis === 'ok' ? 'ok' : 'fail',
      checks: { db, redis },
    };
    if (report.status !== 'ok') {
      throw new HttpException(report, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return report;
  }

  private async probe(
    name: string,
    run: () => Promise<void>,
  ): Promise<CheckStatus> {
    try {
      await run();
      return 'ok';
    } catch (err) {
      this.logger.error(
        `health.${name}.fail message=${(err as Error).message}`,
      );
      return 'fail';
    }
  }
}

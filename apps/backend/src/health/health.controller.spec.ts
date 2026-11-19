import { HttpException, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { DbService } from '../db/db.service';
import { HealthController } from './health.controller';

function makeController(opts: { dbFails?: boolean; redisFails?: boolean }) {
  const db = {
    ping: opts.dbFails
      ? jest.fn().mockRejectedValue(new Error('db down'))
      : jest.fn().mockResolvedValue(undefined),
  } as unknown as DbService;
  const redis = {
    ping: opts.redisFails
      ? jest.fn().mockRejectedValue(new Error('redis down'))
      : jest.fn().mockResolvedValue('PONG'),
  } as unknown as Redis;
  return new HealthController(db, redis);
}

describe('HealthController', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('answers liveness without touching Postgres or Redis', () => {
    const dbPing = jest.fn();
    const redisPing = jest.fn();
    const controller = new HealthController(
      { ping: dbPing } as unknown as DbService,
      { ping: redisPing } as unknown as Redis,
    );

    // Platform checks call this every few seconds; a query here would keep a
    // scale-to-zero database awake.
    expect(controller.live()).toEqual({ status: 'ok' });
    expect(dbPing).not.toHaveBeenCalled();
    expect(redisPing).not.toHaveBeenCalled();
  });

  it('reports ok when both dependencies answer', async () => {
    await expect(makeController({}).check()).resolves.toEqual({
      status: 'ok',
      checks: { db: 'ok', redis: 'ok' },
    });
  });

  it('returns 503 with the failing check named when Postgres is down', async () => {
    const err = await makeController({ dbFails: true })
      .check()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(503);
    expect((err as HttpException).getResponse()).toEqual({
      status: 'fail',
      checks: { db: 'fail', redis: 'ok' },
    });
  });

  it('returns 503 when Redis is down', async () => {
    const err = await makeController({ redisFails: true })
      .check()
      .catch((e: unknown) => e);
    expect((err as HttpException).getStatus()).toBe(503);
    expect((err as HttpException).getResponse()).toMatchObject({
      checks: { db: 'ok', redis: 'fail' },
    });
  });
});

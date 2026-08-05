import type { Redis } from 'ioredis';
import { RedisSessionStore } from './redis-session-store';

function makeFakeRedis(opts: { existsResult?: number } = {}) {
  const setMock = jest.fn().mockResolvedValue('OK');
  const existsMock = jest.fn().mockResolvedValue(opts.existsResult ?? 0);
  const delMock = jest.fn().mockResolvedValue(1);
  const redis = {
    set: setMock,
    exists: existsMock,
    del: delMock,
  } as unknown as Redis;
  return { redis, setMock, existsMock, delMock };
}

describe('RedisSessionStore', () => {
  it('touch sets the active marker with an EX ttl', async () => {
    const { redis, setMock } = makeFakeRedis();
    const store = new RedisSessionStore(redis);
    await store.touch('s1', 2_592_000);
    expect(setMock).toHaveBeenCalledWith(
      'session:active:s1',
      '1',
      'EX',
      2_592_000,
    );
  });

  it('isActive is true when the marker exists', async () => {
    const { redis } = makeFakeRedis({ existsResult: 1 });
    const store = new RedisSessionStore(redis);
    expect(await store.isActive('s1')).toBe(true);
  });

  it('isActive is false when the marker is absent', async () => {
    const { redis } = makeFakeRedis({ existsResult: 0 });
    const store = new RedisSessionStore(redis);
    expect(await store.isActive('s1')).toBe(false);
  });

  it('clear deletes the active marker', async () => {
    const { redis, delMock } = makeFakeRedis();
    const store = new RedisSessionStore(redis);
    await store.clear('s1');
    expect(delMock).toHaveBeenCalledWith('session:active:s1');
  });
});

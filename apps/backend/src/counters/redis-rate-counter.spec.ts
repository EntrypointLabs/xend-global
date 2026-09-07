import type { Redis } from 'ioredis';
import { RedisRateCounter } from './redis-rate-counter';

interface PipelineCall {
  cmd: string;
  args: unknown[];
}

interface FakePipeline {
  incr: jest.Mock;
  incrby: jest.Mock;
  decr: jest.Mock;
  decrby: jest.Mock;
  expire: jest.Mock;
  exec: jest.Mock;
}

function makeFakeRedis(
  opts: {
    incrResult?: number;
    incrbyResult?: string | number;
    mget?: (string | null)[];
    evalResult?: [number, number, number];
  } = {},
) {
  const pipelineCalls: PipelineCall[] = [];
  const pipeline = {} as FakePipeline;
  const record = (cmd: string): jest.Mock =>
    jest.fn((...args: unknown[]) => {
      pipelineCalls.push({ cmd, args });
      return pipeline;
    });
  pipeline.incr = record('incr');
  pipeline.incrby = record('incrby');
  pipeline.expire = record('expire');
  pipeline.exec = jest.fn().mockResolvedValue([
    [null, opts.incrResult ?? 1],
    [null, opts.incrbyResult ?? '0'],
    [null, 1],
    [null, 1],
  ]);

  pipeline.decr = record('decr');
  pipeline.decrby = record('decrby');

  const mgetMock = jest.fn().mockResolvedValue(opts.mget ?? [null, null]);
  const delMock = jest.fn().mockResolvedValue(1);
  const evalMock = jest.fn().mockResolvedValue(opts.evalResult ?? [1, 1, 0]);
  const redis = {
    multi: jest.fn(() => pipeline),
    mget: mgetMock,
    del: delMock,
    eval: evalMock,
  } as unknown as Redis;

  return { redis, pipelineCalls, pipeline, mgetMock, delMock, evalMock };
}

describe('RedisRateCounter', () => {
  it('increments count and amount and sets an NX TTL on both keys', async () => {
    const { redis, pipelineCalls } = makeFakeRedis({
      incrResult: 3,
      incrbyResult: '150',
    });
    const counter = new RedisRateCounter(redis);

    const snap = await counter.increment(
      'cap:consumer:c1:day:20260712',
      '50',
      93600,
    );

    expect(snap).toEqual({ count: 3, totalRaw: '150' });
    expect(pipelineCalls).toEqual([
      { cmd: 'incr', args: ['cap:consumer:c1:day:20260712:count'] },
      { cmd: 'incrby', args: ['cap:consumer:c1:day:20260712:amount', '50'] },
      {
        cmd: 'expire',
        args: ['cap:consumer:c1:day:20260712:count', 93600, 'NX'],
      },
      {
        cmd: 'expire',
        args: ['cap:consumer:c1:day:20260712:amount', 93600, 'NX'],
      },
    ]);
  });

  it('returns the accumulated total as an exact string, not a lossy number', async () => {
    // A value past Number.MAX_SAFE_INTEGER survives as a string total.
    const { redis } = makeFakeRedis({
      incrResult: 1,
      incrbyResult: '9007199254740993',
    });
    const counter = new RedisRateCounter(redis);
    const snap = await counter.increment('k', '1', 10);
    expect(snap.totalRaw).toBe('9007199254740993');
  });

  it('throws when the pipeline returns no replies', async () => {
    const { redis, pipeline } = makeFakeRedis();
    pipeline.exec.mockResolvedValue(null);
    const counter = new RedisRateCounter(redis);
    await expect(counter.increment('k', '1', 10)).rejects.toThrow(/no replies/);
  });

  it('peek defaults absent keys to count 0 and total "0"', async () => {
    const { redis } = makeFakeRedis({ mget: [null, null] });
    const counter = new RedisRateCounter(redis);
    expect(await counter.peek('k')).toEqual({ count: 0, totalRaw: '0' });
  });

  it('peek reads the count and amount keys and returns a string total', async () => {
    const { redis, mgetMock } = makeFakeRedis({ mget: ['4', '200'] });
    const counter = new RedisRateCounter(redis);

    const snap = await counter.peek('cap:consumer:c1:day:20260712');

    expect(snap).toEqual({ count: 4, totalRaw: '200' });
    expect(mgetMock).toHaveBeenCalledWith(
      'cap:consumer:c1:day:20260712:count',
      'cap:consumer:c1:day:20260712:amount',
    );
  });

  it('reserve runs the atomic script over both keys with amount, cap and ttl', async () => {
    const { redis, evalMock } = makeFakeRedis({ evalResult: [1, 3, 150] });
    const counter = new RedisRateCounter(redis);

    const result = await counter.reserve(
      'cap:consumer:c1:day:20260712',
      '50',
      '200',
      93600,
    );

    expect(result).toEqual({
      allowed: true,
      snapshot: { count: 3, totalRaw: '150' },
    });
    const [script, numKeys, ...rest] = evalMock.mock.calls[0] as [
      string,
      number,
      ...unknown[],
    ];
    expect(script).toContain('INCRBY');
    expect(script).toContain('DECRBY');
    expect(numKeys).toBe(2);
    expect(rest).toEqual([
      'cap:consumer:c1:day:20260712:count',
      'cap:consumer:c1:day:20260712:amount',
      '50',
      '200',
      93600,
    ]);
  });

  it('reserve reports a refusal with the window left where it was', async () => {
    const { redis } = makeFakeRedis({ evalResult: [0, 4, 180] });
    const counter = new RedisRateCounter(redis);
    const result = await counter.reserve('k', '30', '200', 10);
    expect(result).toEqual({
      allowed: false,
      snapshot: { count: 4, totalRaw: '180' },
    });
  });

  it('release decrements the amount and the count', async () => {
    const { redis, pipelineCalls } = makeFakeRedis();
    const counter = new RedisRateCounter(redis);
    await counter.release('cap:consumer:c1:day:20260712', '50');
    expect(pipelineCalls).toEqual([
      { cmd: 'decrby', args: ['cap:consumer:c1:day:20260712:amount', '50'] },
      { cmd: 'decr', args: ['cap:consumer:c1:day:20260712:count'] },
    ]);
  });

  it('clear deletes both keys', async () => {
    const { redis, delMock } = makeFakeRedis();
    const counter = new RedisRateCounter(redis);
    await counter.clear('cap:consumer:c1:day:20260712');
    expect(delMock).toHaveBeenCalledWith(
      'cap:consumer:c1:day:20260712:count',
      'cap:consumer:c1:day:20260712:amount',
    );
  });
});

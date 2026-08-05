import type { DbService } from '../db/db.service';
import { idempotencyKeys } from '../db/schema';
import { IdempotencyService } from './idempotency.service';

type IdemRow = typeof idempotencyKeys.$inferSelect;

function pgError(code: string): Error {
  return Object.assign(new Error(`pg error ${code}`), { code });
}

function makeFakeDb(cfg: { selects?: IdemRow[][]; insertError?: Error }) {
  const selects = [...(cfg.selects ?? [])];
  const inserts: unknown[] = [];
  const selectChain = (rows: unknown[]) => ({
    where: () => ({ limit: () => Promise.resolve(rows) }),
  });
  const client = {
    select: () => ({
      from: (tbl: unknown) => {
        if (tbl === idempotencyKeys) return selectChain(selects.shift() ?? []);
        throw new Error('unknown table');
      },
    }),
    insert: () => ({
      values: (v: unknown) => {
        inserts.push(v);
        if (cfg.insertError) return Promise.reject(cfg.insertError);
        return Promise.resolve();
      },
    }),
  };
  return { db: { client } as unknown as DbService, inserts };
}

function idemRow(over: Partial<IdemRow> = {}): IdemRow {
  return {
    id: 'ik1',
    merchantId: 'm1',
    idempotencyKey: 'idem-1',
    requestHash: 'hash-a',
    responseStatus: 201,
    responseBody: JSON.stringify({ id: 'pi_stored' }),
    createdAt: new Date('2026-01-01'),
    ...over,
  };
}

describe('IdempotencyService.run', () => {
  it('runs produce when no key is provided', async () => {
    const { db } = makeFakeDb({});
    const service = new IdempotencyService(db);
    const produce = jest
      .fn()
      .mockResolvedValue({ status: 201, body: { id: 'pi_new' } });
    const result = await service.run('m1', undefined, 'hash-a', produce);
    expect(produce).toHaveBeenCalledTimes(1);
    expect(result.body).toEqual({ id: 'pi_new' });
  });

  it('returns the stored response on a same-key same-body replay without re-running produce', async () => {
    const { db } = makeFakeDb({ selects: [[idemRow()]] });
    const service = new IdempotencyService(db);
    const produce = jest.fn();
    const result = await service.run('m1', 'idem-1', 'hash-a', produce);
    expect(produce).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 201, body: { id: 'pi_stored' } });
  });

  it('throws IDEMPOTENCY_KEY_REUSE on a same-key different-body reuse', async () => {
    const { db } = makeFakeDb({
      selects: [[idemRow({ requestHash: 'hash-a' })]],
    });
    const service = new IdempotencyService(db);
    await expect(
      service.run('m1', 'idem-1', 'hash-DIFFERENT', jest.fn()),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSE' });
  });

  it('inserts a snapshot and returns the produced result on first use', async () => {
    const { db, inserts } = makeFakeDb({ selects: [[]] });
    const service = new IdempotencyService(db);
    const result = await service.run('m1', 'idem-1', 'hash-a', () =>
      Promise.resolve({ status: 201, body: { id: 'pi_new' } }),
    );
    expect(result.body).toEqual({ id: 'pi_new' });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      merchantId: 'm1',
      idempotencyKey: 'idem-1',
      requestHash: 'hash-a',
      responseStatus: 201,
    });
  });

  it('returns the stored winner when the insert loses a 23505 race', async () => {
    const { db } = makeFakeDb({
      // First select: pre-check misses. Second select: post-race re-read.
      selects: [
        [],
        [idemRow({ responseBody: JSON.stringify({ id: 'pi_winner' }) })],
      ],
      insertError: pgError('23505'),
    });
    const service = new IdempotencyService(db);
    const result = await service.run('m1', 'idem-1', 'hash-a', () =>
      Promise.resolve({ status: 201, body: { id: 'pi_loser' } }),
    );
    expect(result.body).toEqual({ id: 'pi_winner' });
  });
});

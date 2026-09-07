import type { DbService } from '../db/db.service';
import {
  payments,
  paymentIntents,
  refunds,
  settlementAccounts,
  squadsAccounts,
} from '../db/schema';
import type { SettlementRouter } from '../settlement/settlement-router';
import type { SettlementProvider } from '../settlement/settlement-provider.interface';
import { IdempotencyService } from './idempotency.service';
import { RefundService } from './refund.service';

interface DbCfg {
  payment?: Record<string, unknown> | null;
  intentStatus?: string | null;
  intentMode?: 'test' | 'live';
  priorRefunds?: { amountUsdcRaw: string; status: string }[];
  account?: { address: string | null; currency: string | null } | null;
  consumerAccount?: { vaultAddress: string } | null;
}

/** A lock that really serialises: callers on the same key run one after another. */
function fakeAdvisoryLock() {
  const tails = new Map<string, Promise<unknown>>();
  return <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const prev = tails.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    tails.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  };
}

function whereResult(rows: unknown[]) {
  return Object.assign(Promise.resolve(rows), {
    limit: () => Promise.resolve(rows),
  });
}

function makeDb(cfg: DbCfg) {
  const updates: Record<string, unknown>[] = [];
  const inserts: Record<string, unknown>[] = [];
  const lockKeys: string[] = [];
  const client = {
    select: () => ({
      from: (tbl: unknown) => {
        let rows: unknown[] = [];
        if (tbl === payments) rows = cfg.payment ? [cfg.payment] : [];
        else if (tbl === paymentIntents)
          rows = cfg.intentStatus
            ? [{ status: cfg.intentStatus, mode: cfg.intentMode ?? 'live' }]
            : [];
        // Refunds written by an earlier call are visible to the next one,
        // which is what the lock is for.
        else if (tbl === refunds)
          rows = [...(cfg.priorRefunds ?? []), ...inserts];
        else if (tbl === settlementAccounts)
          rows = cfg.account ? [cfg.account] : [];
        else if (tbl === squadsAccounts)
          rows = cfg.consumerAccount ? [cfg.consumerAccount] : [];
        else throw new Error('unknown table');
        return { where: () => whereResult(rows) };
      },
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserts.push(v);
        return {
          returning: () =>
            Promise.resolve([{ id: 'rf_1', createdAt: new Date(), ...v }]),
        };
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        updates.push(v);
        return { where: () => Promise.resolve() };
      },
    }),
  };
  const lock = fakeAdvisoryLock();
  const db = {
    client,
    withAdvisoryLock: (key: string, fn: () => Promise<unknown>) => {
      lockKeys.push(key);
      return lock(key, fn);
    },
  } as unknown as DbService;
  return { db, updates, inserts, lockKeys };
}

function makeProvider(refundSupport: boolean) {
  const reverse = jest.fn().mockResolvedValue({ signature: 'revsig' });
  const provider = {
    capabilities: {
      provider: 'direct_usdc',
      currencies: ['USDC'],
      refundSupport,
      settlementLatency: 'instant',
    },
    reverse,
  } as unknown as SettlementProvider;
  const router = { forMerchant: () => provider } as unknown as SettlementRouter;
  return { router, reverse };
}

/** A real-behaviour idempotency fake: first call runs produce and stores;
 *  a replay with the same key returns the stored result without re-running. */
function makeIdempotency() {
  const store = new Map<string, { status: number; body: unknown }>();
  return {
    run: async (
      merchantId: string,
      key: string | undefined,
      _hash: string,
      produce: () => Promise<{ status: number; body: unknown }>,
    ) => {
      if (!key) return produce();
      const k = `${merchantId}:${key}`;
      const existing = store.get(k);
      if (existing) return existing;
      const res = await produce();
      store.set(k, res);
      return res;
    },
  } as unknown as IdempotencyService;
}

function payment(over: Record<string, unknown> = {}) {
  return {
    id: 'pay_1',
    intentId: 'pi_1',
    merchantId: 'm1',
    consumerId: 'c1',
    usdcSettlementRaw: '1000000',
    ...over,
  };
}

const account = { address: 'EndpointAddr', currency: 'USDC' };
const consumerAccount = { vaultAddress: 'VaultAddr' };

describe('RefundService.refund', () => {
  it('reverses the full remainder to the Consumer vault and records the provider reference', async () => {
    const { db, inserts, updates, lockKeys } = makeDb({
      payment: payment(),
      intentStatus: 'succeeded',
      priorRefunds: [],
      account,
      consumerAccount,
    });
    const { router, reverse } = makeProvider(true);
    const svc = new RefundService(db, router, makeIdempotency());

    const result = await svc.refund({
      paymentId: 'pay_1',
      idempotencyKey: 'k',
    });

    expect(result.amount_usdc_raw).toBe('1000000');
    expect(result.provider_reference).toBe('revsig');
    expect(reverse).toHaveBeenCalledWith({
      endpointAddress: 'EndpointAddr',
      consumerAddress: 'VaultAddr',
      amountRaw: '1000000',
      paymentId: 'pay_1',
    });
    expect(lockKeys).toEqual(['refund:payment:pay_1']);
    // Durable row written pending BEFORE the provider call, updated after.
    expect(inserts[0]).toMatchObject({ status: 'pending' });
    expect(updates[0]).toMatchObject({
      status: 'succeeded',
      providerReference: 'revsig',
    });
  });

  it('reverses only the requested amount on a partial refund', async () => {
    const { db } = makeDb({
      payment: payment(),
      intentStatus: 'succeeded',
      priorRefunds: [],
      account,
      consumerAccount,
    });
    const { router, reverse } = makeProvider(true);
    const svc = new RefundService(db, router, makeIdempotency());
    const result = await svc.refund({
      paymentId: 'pay_1',
      amountUsdcRaw: '400000',
      idempotencyKey: 'k',
    });
    expect(result.amount_usdc_raw).toBe('400000');
    const calls = reverse.mock.calls as Array<[{ amountRaw: string }]>;
    expect(calls[0][0].amountRaw).toBe('400000');
  });

  it('rejects a refund exceeding the remaining refundable', async () => {
    const { db } = makeDb({
      payment: payment(),
      intentStatus: 'succeeded',
      priorRefunds: [{ amountUsdcRaw: '600000', status: 'succeeded' }],
      account,
      consumerAccount,
    });
    const { router, reverse } = makeProvider(true);
    const svc = new RefundService(db, router, makeIdempotency());
    await expect(
      svc.refund({
        paymentId: 'pay_1',
        amountUsdcRaw: '500000',
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ code: 'REFUND_AMOUNT_EXCEEDS_REFUNDABLE' });
    expect(reverse).not.toHaveBeenCalled();
  });

  it('capability-gates a provider without reverse support', async () => {
    const { db } = makeDb({
      payment: payment(),
      intentStatus: 'succeeded',
      priorRefunds: [],
      account: { address: 'A', currency: 'NGN' },
      consumerAccount,
    });
    const { router, reverse } = makeProvider(false);
    const svc = new RefundService(db, router, makeIdempotency());
    await expect(
      svc.refund({ paymentId: 'pay_1', idempotencyKey: 'k' }),
    ).rejects.toMatchObject({
      code: 'REFUND_NOT_SUPPORTED',
    });
    expect(reverse).not.toHaveBeenCalled();
  });

  it('rejects a refund on a non-succeeded payment', async () => {
    const { db } = makeDb({
      payment: payment(),
      intentStatus: 'settling',
      account,
      consumerAccount,
    });
    const { router } = makeProvider(true);
    const svc = new RefundService(db, router, makeIdempotency());
    await expect(
      svc.refund({ paymentId: 'pay_1', idempotencyKey: 'k' }),
    ).rejects.toMatchObject({
      code: 'PAYMENT_NOT_REFUNDABLE',
    });
  });

  it('refuses a refund without an Idempotency-Key before reading anything', async () => {
    const { db } = makeDb({
      payment: payment(),
      intentStatus: 'succeeded',
      account,
      consumerAccount,
    });
    const { router, reverse } = makeProvider(true);
    const svc = new RefundService(db, router, makeIdempotency());
    await expect(
      svc.refund({ paymentId: 'pay_1', idempotencyKey: '' }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    expect(reverse).not.toHaveBeenCalled();
  });

  it('decides two concurrent full refunds under different keys one after the other', async () => {
    const { db } = makeDb({
      payment: payment(),
      intentStatus: 'succeeded',
      priorRefunds: [],
      account,
      consumerAccount,
    });
    const { router, reverse } = makeProvider(true);
    const svc = new RefundService(db, router, makeIdempotency());

    const [first, second] = await Promise.allSettled([
      svc.refund({ paymentId: 'pay_1', idempotencyKey: 'k1' }),
      svc.refund({ paymentId: 'pay_1', idempotencyKey: 'k2' }),
    ]);

    expect(first.status).toBe('fulfilled');
    expect(second.status).toBe('rejected');
    expect((second as PromiseRejectedResult).reason).toMatchObject({
      code: 'REFUND_AMOUNT_EXCEEDS_REFUNDABLE',
    });
    expect(reverse).toHaveBeenCalledTimes(1);
  });

  it('rejects an absent payment', async () => {
    const { db } = makeDb({ payment: null });
    const { router } = makeProvider(true);
    const svc = new RefundService(db, router, makeIdempotency());
    await expect(
      svc.refund({ paymentId: 'ghost', idempotencyKey: 'k' }),
    ).rejects.toMatchObject({
      code: 'REFUND_NOT_FOUND',
    });
  });

  it('returns the first refund on a retried Idempotency-Key without a second reverse', async () => {
    const { db } = makeDb({
      payment: payment(),
      intentStatus: 'succeeded',
      priorRefunds: [],
      account,
      consumerAccount,
    });
    const { router, reverse } = makeProvider(true);
    const idem = makeIdempotency();
    const svc = new RefundService(db, router, idem);

    const first = await svc.refund({
      paymentId: 'pay_1',
      idempotencyKey: 'k1',
    });
    const second = await svc.refund({
      paymentId: 'pay_1',
      idempotencyKey: 'k1',
    });

    expect(reverse).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('does not reverse again when it loses the unique-index race', async () => {
    // Simulates a concurrent duplicate that slips past the response-snapshot
    // idempotency layer: the refunds insert loses on the (merchant,
    // idempotency_key) unique index (23505), so the reverse must not fire and
    // the winner's record is returned instead.
    const winner = {
      id: 'rf_winner',
      paymentId: 'pay_1',
      merchantId: 'm1',
      status: 'succeeded',
      amountUsdcRaw: '1000000',
      providerReference: 'revsig',
      createdAt: new Date(),
    };
    let refundsSelects = 0;
    const client = {
      select: () => ({
        from: (tbl: unknown) => {
          let rows: unknown[] = [];
          if (tbl === payments) rows = [payment()];
          else if (tbl === paymentIntents) rows = [{ status: 'succeeded' }];
          // 1st refunds select = remainder calc (none prior); 2nd = the
          // post-23505 lookup that returns the winning refund.
          else if (tbl === refunds)
            rows = refundsSelects++ === 0 ? [] : [winner];
          else if (tbl === settlementAccounts) rows = [account];
          else if (tbl === squadsAccounts) rows = [consumerAccount];
          else throw new Error('unknown table');
          return { where: () => whereResult(rows) };
        },
      }),
      insert: () => ({
        values: () => ({
          returning: () =>
            Promise.reject(
              Object.assign(new Error('duplicate'), { code: '23505' }),
            ),
        }),
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    };
    const db = {
      client,
      withAdvisoryLock: (_k: string, fn: () => Promise<unknown>) => fn(),
    } as unknown as DbService;
    const { router, reverse } = makeProvider(true);
    const svc = new RefundService(db, router, makeIdempotency());

    const result = await svc.refund({
      paymentId: 'pay_1',
      idempotencyKey: 'k1',
    });

    expect(reverse).not.toHaveBeenCalled();
    expect(result.id).toBe('rf_winner');
    expect(result.status).toBe('succeeded');
    expect(result.provider_reference).toBe('revsig');
  });
});

describe('RefundService.refund (test mode)', () => {
  it('records a simulated refund under a test_ reference with no provider, endpoint or vault involved', async () => {
    const { db, inserts, updates } = makeDb({
      payment: payment(),
      intentStatus: 'succeeded',
      intentMode: 'test',
      priorRefunds: [],
      account: null,
      consumerAccount: null,
    });
    const { router, reverse } = makeProvider(true);
    const svc = new RefundService(db, router, makeIdempotency());

    const result = await svc.refund({
      paymentId: 'pay_1',
      amountUsdcRaw: '400000',
      idempotencyKey: 'k-test',
    });

    expect(reverse).not.toHaveBeenCalled();
    expect(result.status).toBe('succeeded');
    expect(result.amount_usdc_raw).toBe('400000');
    expect(result.provider_reference).toBe('test_rf_1');
    expect(inserts[0]).toMatchObject({
      status: 'pending',
      amountUsdcRaw: '400000',
    });
    expect(updates[0]).toMatchObject({
      status: 'succeeded',
      providerReference: 'test_rf_1',
    });
  });

  it('still enforces the refundable remainder in test mode', async () => {
    const { db } = makeDb({
      payment: payment(),
      intentStatus: 'succeeded',
      intentMode: 'test',
      priorRefunds: [{ amountUsdcRaw: '900000', status: 'succeeded' }],
      account: null,
      consumerAccount: null,
    });
    const { router } = makeProvider(true);
    const svc = new RefundService(db, router, makeIdempotency());
    await expect(
      svc.refund({
        paymentId: 'pay_1',
        amountUsdcRaw: '200000',
        idempotencyKey: 'k2',
      }),
    ).rejects.toMatchObject({ code: 'REFUND_AMOUNT_EXCEEDS_REFUNDABLE' });
  });
});

import type { DbService } from '../db/db.service';
import {
  payments,
  paymentIntents,
  refunds,
  settlementAccounts,
  smartAccounts,
} from '../db/schema';
import type { SettlementRouter } from '../settlement/settlement-router';
import type { SettlementProvider } from '../settlement/settlement-provider.interface';
import { IdempotencyService } from './idempotency.service';
import { RefundService } from './refund.service';

interface DbCfg {
  payment?: Record<string, unknown> | null;
  intentStatus?: string | null;
  priorRefunds?: { amountUsdcRaw: string; status: string }[];
  account?: { address: string | null; currency: string | null } | null;
  consumerAccount?: { walletAddress: string } | null;
}

function whereResult(rows: unknown[]) {
  return Object.assign(Promise.resolve(rows), {
    limit: () => Promise.resolve(rows),
  });
}

function makeDb(cfg: DbCfg) {
  const updates: Record<string, unknown>[] = [];
  const inserts: Record<string, unknown>[] = [];
  const client = {
    select: () => ({
      from: (tbl: unknown) => {
        let rows: unknown[] = [];
        if (tbl === payments) rows = cfg.payment ? [cfg.payment] : [];
        else if (tbl === paymentIntents)
          rows = cfg.intentStatus ? [{ status: cfg.intentStatus }] : [];
        else if (tbl === refunds) rows = cfg.priorRefunds ?? [];
        else if (tbl === settlementAccounts)
          rows = cfg.account ? [cfg.account] : [];
        else if (tbl === smartAccounts)
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
  return { db: { client } as unknown as DbService, updates, inserts };
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
const consumerAccount = { walletAddress: 'ConsumerAddr' };

describe('RefundService.refund', () => {
  it('reverses the full remainder and records the provider reference', async () => {
    const { db, inserts, updates } = makeDb({
      payment: payment(),
      intentStatus: 'succeeded',
      priorRefunds: [],
      account,
      consumerAccount,
    });
    const { router, reverse } = makeProvider(true);
    const svc = new RefundService(db, router, makeIdempotency());

    const result = await svc.refund({ paymentId: 'pay_1' });

    expect(result.amount_usdc_raw).toBe('1000000');
    expect(result.provider_reference).toBe('revsig');
    expect(reverse).toHaveBeenCalledWith({
      endpointAddress: 'EndpointAddr',
      consumerAddress: 'ConsumerAddr',
      amountRaw: '1000000',
      paymentId: 'pay_1',
    });
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
      svc.refund({ paymentId: 'pay_1', amountUsdcRaw: '500000' }),
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
    await expect(svc.refund({ paymentId: 'pay_1' })).rejects.toMatchObject({
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
    await expect(svc.refund({ paymentId: 'pay_1' })).rejects.toMatchObject({
      code: 'PAYMENT_NOT_REFUNDABLE',
    });
  });

  it('rejects an absent payment', async () => {
    const { db } = makeDb({ payment: null });
    const { router } = makeProvider(true);
    const svc = new RefundService(db, router, makeIdempotency());
    await expect(svc.refund({ paymentId: 'ghost' })).rejects.toMatchObject({
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
});

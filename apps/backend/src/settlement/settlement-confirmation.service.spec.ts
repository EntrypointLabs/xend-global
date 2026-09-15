import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { DbService } from '../db/db.service';
import { paymentAttempts, payments } from '../db/schema';
import type { SolanaRpc } from '../solana/solana-rpc.interface';
import type { PaymentIntentService } from '../payment/payment-intent.service';
import { IntentStateConflictError } from '../payment/payment.errors';
import type {
  EventPublisher,
  PlatformEvent,
} from '../events/event-publisher.interface';
import type { SettlementProvisioningService } from './settlement-provisioning.service';
import { SettlementRouter } from './settlement-router';
import type {
  SettlementCompletion,
  SettlementProvider,
} from './settlement-provider.interface';
import { SettlementConfirmationService } from './settlement-confirmation.service';

const PAYMENT_ROW = {
  id: 'pay_1',
  intentId: 'pi_1',
  merchantId: 'm_1',
  consumerId: 'u_1',
  usdcSettlementRaw: '1000000',
  displayCurrency: 'USD',
  displayAmountMinor: '1000',
  txSignature: 'sig-1',
  settledAt: new Date(),
  refundOfPaymentId: null,
  createdAt: new Date(),
};

function makeConfig(budgetMs = 15): ConfigService {
  return {
    getOrThrow: (key: string): number => {
      if (key === 'SETTLEMENT_CONFIRM_POLL_INTERVAL_MS') return 1;
      if (key === 'SETTLEMENT_CONFIRM_BUDGET_MS') return budgetMs;
      throw new Error(`missing config ${key}`);
    },
  } as unknown as ConfigService;
}

function makeDb(cfg: {
  claim?: { intentId: string }[][];
  payment?: typeof PAYMENT_ROW | null;
  inserts?: unknown[];
}): DbService {
  const claims = [...(cfg.claim ?? [])];
  const thenableWhere = (returningResult: unknown[]) => {
    const p = Promise.resolve([]) as Promise<unknown[]> & {
      returning?: () => Promise<unknown[]>;
    };
    p.returning = () => Promise.resolve(returningResult);
    return p;
  };
  const client = {
    update: (tbl: unknown) => ({
      set: () => ({
        where: () =>
          thenableWhere(tbl === paymentAttempts ? (claims.shift() ?? []) : []),
      }),
    }),
    insert: () => ({
      values: (v: unknown) => ({
        onConflictDoNothing: () => {
          cfg.inserts?.push(v);
          return Promise.resolve(undefined);
        },
      }),
    }),
    select: () => ({
      from: (tbl: unknown) => ({
        where: () => ({
          limit: () =>
            Promise.resolve(
              tbl === payments && cfg.payment ? [cfg.payment] : [],
            ),
        }),
      }),
    }),
  };
  return { client } as unknown as DbService;
}

function makeExecDb(cfg: {
  settling?: unknown[];
  claimedUnfinished?: unknown[];
  authorized?: unknown[];
  orphanHit?: boolean;
  reapRowCount?: number;
  captured?: string[];
}): DbService {
  const execute = jest.fn((stmt: unknown) => {
    const str = JSON.stringify(stmt);
    cfg.captured?.push(str);
    if (str.includes('UPDATE payment_attempts')) {
      return Promise.resolve({ rowCount: cfg.reapRowCount ?? 1 });
    }
    if (str.includes('FROM transfers')) {
      return Promise.resolve({ rows: cfg.orphanHit ? [{ n: 1 }] : [] });
    }
    if (str.includes("pa.status = 'succeeded'")) {
      return Promise.resolve({ rows: cfg.claimedUnfinished ?? [] });
    }
    if (str.includes("status = 'settling'")) {
      return Promise.resolve({ rows: cfg.settling ?? [] });
    }
    if (str.includes("status = 'authorized'")) {
      return Promise.resolve({ rows: cfg.authorized ?? [] });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  return { client: { execute } } as unknown as DbService;
}

function makeProvider(completion: SettlementCompletion): {
  provider: SettlementProvider;
  handleIncomingSettlement: jest.Mock;
} {
  const handleIncomingSettlement = jest.fn().mockResolvedValue(completion);
  const provider: SettlementProvider = {
    capabilities: {
      provider: 'direct_usdc',
      currencies: ['USDC'],
      refundSupport: true,
      settlementLatency: 'instant',
    },
    provision: jest.fn(),
    handleIncomingSettlement,
    reverse: jest.fn(),
    report: jest.fn(),
  };
  return { provider, handleIncomingSettlement };
}

function makeIntents() {
  const findById = jest.fn().mockResolvedValue({
    id: 'pi_1',
    merchantId: 'm_1',
    consumerId: 'u_1',
    usdcSettlementRaw: '1000000',
  });
  const transition = jest.fn().mockResolvedValue({});
  return {
    intents: { findById, transition } as unknown as PaymentIntentService,
    findById,
    transition,
  };
}

function makeProvisioning() {
  return {
    getSettlementAddressForSettlement: jest
      .fn()
      .mockResolvedValue({ address: 'ENDPOINT', provider: 'direct_usdc' }),
  } as unknown as SettlementProvisioningService;
}

function makePublisher() {
  const events: PlatformEvent[] = [];
  const publish = jest.fn((e: PlatformEvent) => {
    events.push(e);
    return Promise.resolve();
  });
  return { publisher: { publish } as EventPublisher, events, publish };
}

function makeSolana(statuses: unknown[]): SolanaRpc {
  return {
    getSignatureStatuses: jest.fn().mockResolvedValue(statuses),
  } as unknown as SolanaRpc;
}

function makeService(deps: {
  db: DbService;
  solana?: SolanaRpc;
  intents: PaymentIntentService;
  provisioning?: SettlementProvisioningService;
  provider: SettlementProvider;
  publisher: EventPublisher;
  budgetMs?: number;
}): SettlementConfirmationService {
  const service = new SettlementConfirmationService(
    deps.db,
    makeConfig(deps.budgetMs),
    deps.solana ?? makeSolana([]),
    deps.intents,
    deps.provisioning ?? makeProvisioning(),
    new SettlementRouter([deps.provider]),
    deps.publisher,
  );
  service.onModuleInit();
  return service;
}

describe('SettlementConfirmationService', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  describe('awaitConfirmation', () => {
    it('finalizes on the first confirmed status', async () => {
      const { provider } = makeProvider({ status: 'complete' });
      const { intents } = makeIntents();
      const { publisher } = makePublisher();
      const service = makeService({
        db: makeDb({}),
        solana: makeSolana([
          {
            signature: 'sig-1',
            slot: 1n,
            confirmationStatus: 'confirmed',
            err: null,
          },
        ]),
        intents,
        provider,
        publisher,
        // Generous budget so the first poll is always reached; the confirmed
        // status returns immediately, keeping the test instant while removing
        // the deadline race that flaked on slower CI runners.
        budgetMs: 5000,
      });
      const spy = jest
        .spyOn(service, 'finalizeSucceeded')
        .mockResolvedValue(undefined);

      await service.awaitConfirmation('pi_1', 'sig-1');
      expect(spy).toHaveBeenCalledWith('pi_1', 'sig-1');
    });

    it('finalizes as failed when a confirmed status carries a transaction error', async () => {
      const { provider } = makeProvider({ status: 'complete' });
      const { intents } = makeIntents();
      const { publisher } = makePublisher();
      const service = makeService({
        db: makeDb({}),
        solana: makeSolana([
          {
            signature: 'sig-1',
            slot: 1n,
            confirmationStatus: 'confirmed',
            err: { InstructionError: [0, 'Custom'] },
          },
        ]),
        intents,
        provider,
        publisher,
        budgetMs: 5000,
      });
      const succeeded = jest
        .spyOn(service, 'finalizeSucceeded')
        .mockResolvedValue(undefined);
      const failed = jest
        .spyOn(service, 'finalizeFailed')
        .mockResolvedValue(undefined);

      await service.awaitConfirmation('pi_1', 'sig-1');

      expect(succeeded).not.toHaveBeenCalled();
      expect(failed).toHaveBeenCalledWith('pi_1', 'sig-1', {
        code: 'CHAIN_ERROR',
        err: { InstructionError: [0, 'Custom'] },
      });
    });

    it('does not force-fail on budget exhaustion (statuses stay null)', async () => {
      const { provider } = makeProvider({ status: 'complete' });
      const { intents } = makeIntents();
      const { publisher, publish } = makePublisher();
      const service = makeService({
        db: makeDb({}),
        solana: makeSolana([
          {
            signature: 'sig-1',
            slot: null,
            confirmationStatus: null,
            err: null,
          },
        ]),
        intents,
        provider,
        publisher,
      });
      const succeeded = jest
        .spyOn(service, 'finalizeSucceeded')
        .mockResolvedValue(undefined);
      const failed = jest
        .spyOn(service, 'finalizeFailed')
        .mockResolvedValue(undefined);

      await service.awaitConfirmation('pi_1', 'sig-1');
      expect(succeeded).not.toHaveBeenCalled();
      expect(failed).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    });
  });

  describe('finalizeSucceeded', () => {
    it('claims, calls the provider, writes the payment, and publishes payment.succeeded (complete)', async () => {
      const { provider, handleIncomingSettlement } = makeProvider({
        status: 'complete',
      });
      const { intents, transition } = makeIntents();
      const { publisher, events } = makePublisher();
      const service = makeService({
        db: makeDb({ claim: [[{ intentId: 'pi_1' }]], payment: PAYMENT_ROW }),
        intents,
        provider,
        publisher,
      });

      await service.finalizeSucceeded('pi_1', 'sig-1');

      expect(handleIncomingSettlement).toHaveBeenCalledTimes(1);
      expect(transition).toHaveBeenCalledWith(
        'pi_1',
        'settling',
        'succeeded',
        {},
      );
      expect(events).toHaveLength(1);
      expect(events[0].topic).toBe('payment.succeeded');
      expect(events[0].correlationId).toBe('pi_1');
      expect(events[0].payload.paymentId).toBe('pay_1');
    });

    it('leaves the intent in settling and publishes nothing when the provider is pending', async () => {
      const { provider } = makeProvider({ status: 'pending' });
      const { intents, transition } = makeIntents();
      const { publisher, publish } = makePublisher();
      const service = makeService({
        db: makeDb({ claim: [[{ intentId: 'pi_1' }]], payment: PAYMENT_ROW }),
        intents,
        provider,
        publisher,
      });

      await service.finalizeSucceeded('pi_1', 'sig-1');

      expect(transition).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    });

    it('MONEY-SAFETY: the provider fires at most once per signature across two finalize calls', async () => {
      const { provider, handleIncomingSettlement } = makeProvider({
        status: 'complete',
      });
      const { intents } = makeIntents();
      const { publisher, publish } = makePublisher();
      // First finalize claims (rowCount 1); the second claims 0 rows.
      const service = makeService({
        db: makeDb({
          claim: [[{ intentId: 'pi_1' }], []],
          payment: PAYMENT_ROW,
        }),
        intents,
        provider,
        publisher,
      });

      await service.finalizeSucceeded('pi_1', 'sig-1');
      await service.finalizeSucceeded('pi_1', 'sig-1');

      expect(handleIncomingSettlement).toHaveBeenCalledTimes(1);
      expect(publish).toHaveBeenCalledTimes(1);
    });
  });

  describe('completeDeferredSettlement', () => {
    it('transitions the intent to succeeded and publishes once; a second call no-ops', async () => {
      const { provider } = makeProvider({ status: 'complete' });
      const { intents, transition } = makeIntents();
      transition
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(
          new IntentStateConflictError('already succeeded'),
        );
      const { publisher, publish } = makePublisher();
      const service = makeService({
        db: makeDb({ payment: PAYMENT_ROW }),
        intents,
        provider,
        publisher,
      });

      const completion: SettlementCompletion = {
        status: 'complete',
        ngnSettledMinor: '150000',
        providerTxRef: 'blk_1',
      };
      await service.completeDeferredSettlement('pay_1', completion);
      await service.completeDeferredSettlement('pay_1', completion);

      expect(transition).toHaveBeenCalledTimes(2);
      expect(publish).toHaveBeenCalledTimes(1);
      expect(publish.mock.calls[0][0].payload.ngnSettledMinor).toBe('150000');
    });
  });

  describe('finalizeFailed', () => {
    it('claims, transitions to failed, and publishes payment.failed', async () => {
      const { provider } = makeProvider({ status: 'complete' });
      const { intents, transition } = makeIntents();
      const { publisher, events } = makePublisher();
      const service = makeService({
        db: makeDb({ claim: [[{ intentId: 'pi_1' }]] }),
        intents,
        provider,
        publisher,
      });

      await service.finalizeFailed('pi_1', 'sig-1', {
        code: 'BLOCKHASH_EXPIRED',
      });

      expect(transition).toHaveBeenCalledWith('pi_1', 'settling', 'failed', {});
      expect(events).toHaveLength(1);
      expect(events[0].topic).toBe('payment.failed');
      expect(events[0].correlationId).toBe('pi_1');
    });
  });

  describe('reconcileSettling (the sweep)', () => {
    it('settling leg force-fails a null-status attempt past blockhash expiry with BLOCKHASH_EXPIRED', async () => {
      const { provider } = makeProvider({ status: 'complete' });
      const { intents } = makeIntents();
      const { publisher } = makePublisher();
      const service = makeService({
        db: makeExecDb({
          settling: [{ txSignature: 'sig-x', intentId: 'pi_1', expired: true }],
        }),
        solana: makeSolana([
          {
            signature: 'sig-x',
            slot: null,
            confirmationStatus: null,
            err: null,
          },
        ]),
        intents,
        provider,
        publisher,
      });
      const failed = jest
        .spyOn(service, 'finalizeFailed')
        .mockResolvedValue(undefined);

      await service.reconcileSettling();

      expect(failed).toHaveBeenCalledWith('pi_1', 'sig-x', {
        code: 'BLOCKHASH_EXPIRED',
      });
    });

    it('settling leg fails a confirmed attempt whose transaction errored instead of succeeding it', async () => {
      const { provider } = makeProvider({ status: 'complete' });
      const { intents } = makeIntents();
      const { publisher } = makePublisher();
      const service = makeService({
        db: makeExecDb({
          settling: [
            { txSignature: 'sig-x', intentId: 'pi_1', expired: false },
          ],
        }),
        solana: makeSolana([
          {
            signature: 'sig-x',
            slot: 5n,
            confirmationStatus: 'finalized',
            err: { InsufficientFundsForFee: {} },
          },
        ]),
        intents,
        provider,
        publisher,
      });
      const succeeded = jest
        .spyOn(service, 'finalizeSucceeded')
        .mockResolvedValue(undefined);
      const failed = jest
        .spyOn(service, 'finalizeFailed')
        .mockResolvedValue(undefined);

      await service.reconcileSettling();

      expect(succeeded).not.toHaveBeenCalled();
      expect(failed).toHaveBeenCalledWith('pi_1', 'sig-x', {
        code: 'CHAIN_ERROR',
        err: { InsufficientFundsForFee: {} },
      });
    });

    // The resume path writes through the query builder, so graft the builder
    // fake onto the execute fake.
    function makeResumeDb(cfg: {
      claimedUnfinished: unknown[];
      captured?: string[];
      inserts?: unknown[];
    }): DbService {
      const execDb = makeExecDb({
        claimedUnfinished: cfg.claimedUnfinished,
        captured: cfg.captured,
      });
      const builderDb = makeDb({ payment: PAYMENT_ROW, inserts: cfg.inserts });
      return {
        client: {
          ...builderDb.client,
          execute: (...args: unknown[]) =>
            (execDb.client.execute as (...a: unknown[]) => unknown)(...args),
        },
      } as unknown as DbService;
    }

    it('finishes a claimed attempt that lost its process before the payments row was written', async () => {
      const { provider, handleIncomingSettlement } = makeProvider({
        status: 'complete',
      });
      const { intents, transition } = makeIntents();
      const { publisher, events } = makePublisher();
      const inserts: unknown[] = [];
      const service = makeService({
        db: makeResumeDb({
          claimedUnfinished: [{ txSignature: 'sig-c', intentId: 'pi_1' }],
          inserts,
        }),
        intents,
        provider,
        publisher,
      });

      await service.reconcileSettling();

      expect(inserts).toHaveLength(1);
      expect(handleIncomingSettlement).toHaveBeenCalledTimes(1);
      expect(transition).toHaveBeenCalledWith(
        'pi_1',
        'settling',
        'succeeded',
        {},
      );
      expect(events.map((e) => e.topic)).toEqual(['payment.succeeded']);
    });

    it('resumes a claimed attempt whose payments row was already written, which the sweep must not exclude', async () => {
      const { provider } = makeProvider({ status: 'complete' });
      const { intents, transition } = makeIntents();
      const { publisher, events } = makePublisher();
      const captured: string[] = [];
      const service = makeService({
        db: makeResumeDb({
          claimedUnfinished: [{ txSignature: 'sig-c', intentId: 'pi_1' }],
          captured,
        }),
        intents,
        provider,
        publisher,
      });

      await service.reconcileSettling();

      // A payments row alone no longer disqualifies a settling attempt; only
      // a payment AND an off-ramp row (a deferred payout) is left alone.
      const resumeQuery = captured.find((c) =>
        c.includes("pa.status = 'succeeded'"),
      );
      expect(resumeQuery).toContain('(p.id IS NULL OR o.id IS NULL)');
      expect(resumeQuery).toContain('settlement_offramps');

      // One sweep finalizes it from the payment row that already exists, and
      // the merchant is told exactly once.
      expect(transition).toHaveBeenCalledWith(
        'pi_1',
        'settling',
        'succeeded',
        {},
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        topic: 'payment.succeeded',
        payload: { intentId: 'pi_1', paymentId: 'pay_1' },
      });
    });

    it('does not publish payment.succeeded twice when a second sweep re-enters a finalized intent', async () => {
      const { provider } = makeProvider({ status: 'complete' });
      const { intents, transition } = makeIntents();
      const { publisher, events } = makePublisher();
      const service = makeService({
        db: makeResumeDb({
          claimedUnfinished: [{ txSignature: 'sig-c', intentId: 'pi_1' }],
        }),
        intents,
        provider,
        publisher,
      });

      await service.reconcileSettling();
      // The first sweep moved the intent out of settling, so the guarded
      // transition refuses the second.
      transition.mockRejectedValueOnce(
        new IntentStateConflictError('intent pi_1 was succeeded'),
      );
      await service.reconcileSettling();

      expect(transition).toHaveBeenCalledTimes(2);
      expect(events.map((e) => e.topic)).toEqual(['payment.succeeded']);
    });

    it('reaper fails an aged authorized attempt (ATTEMPT_ABANDONED) and frees + notifies the parent intent', async () => {
      const { provider } = makeProvider({ status: 'complete' });
      const { intents, transition } = makeIntents();
      const { publisher, publish } = makePublisher();
      const captured: string[] = [];
      const service = makeService({
        db: makeExecDb({
          authorized: [
            {
              id: 'att_1',
              intentId: 'pi_1',
              messageBase64: null,
              merchantId: 'm_1',
              usdcSettlementRaw: '1000000',
            },
          ],
          captured,
        }),
        intents,
        provider,
        publisher,
      });

      await service.reconcileSettling();

      const reapUpdate = captured.find((s) =>
        s.includes('UPDATE payment_attempts'),
      );
      expect(reapUpdate).toContain('ATTEMPT_ABANDONED');
      // The stranded intent is freed to a terminal state (never left authorized
      // with no live attempt) and the merchant is notified.
      expect(transition).toHaveBeenCalledWith(
        'pi_1',
        'authorized',
        'failed',
        {},
      );
      expect(publish).toHaveBeenCalledTimes(1);
      expect(publish.mock.calls[0][0]).toMatchObject({
        topic: 'payment.failed',
        payload: { intentId: 'pi_1', reason: 'ATTEMPT_ABANDONED' },
      });
    });

    it('leaves a freshly-pinned authorized attempt untouched (not returned by the window query)', async () => {
      const { provider } = makeProvider({ status: 'complete' });
      const { intents } = makeIntents();
      const { publisher } = makePublisher();
      const captured: string[] = [];
      const service = makeService({
        db: makeExecDb({ authorized: [], settling: [], captured }),
        intents,
        provider,
        publisher,
      });

      await service.reconcileSettling();

      expect(
        captured.find((s) => s.includes('UPDATE payment_attempts')),
      ).toBeUndefined();
    });

    it('reaps a pinned attempt with a confirmed inbound of the exact amount as ATTEMPT_ORPHAN_SUSPECTED', async () => {
      const { provider } = makeProvider({ status: 'complete' });
      const { intents, transition } = makeIntents();
      const { publisher, publish } = makePublisher();
      const captured: string[] = [];
      const service = makeService({
        db: makeExecDb({
          authorized: [
            {
              id: 'att_1',
              intentId: 'pi_1',
              messageBase64: 'pinned',
              merchantId: 'm_1',
              usdcSettlementRaw: '1000000',
            },
          ],
          orphanHit: true,
          captured,
        }),
        intents,
        provider,
        publisher,
      });

      await service.reconcileSettling();

      const reapUpdate = captured.find((s) =>
        s.includes('UPDATE payment_attempts'),
      );
      expect(reapUpdate).toContain('ATTEMPT_ORPHAN_SUSPECTED');
      // Money may have landed: the intent stays authorized for ops. No
      // auto-fail transition, no merchant-facing failure event.
      expect(transition).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    });
  });
});

describe('SettlementConfirmationService.settleTestMode', () => {
  function intent(mode: 'test' | 'live') {
    return {
      id: 'pi_t',
      mode,
      merchantId: 'm_1',
      consumerId: 'u_1',
      usdcSettlementRaw: '1000000',
      displayCurrency: 'NGN',
      displayAmountMinor: '1600000',
    };
  }

  function makeSandboxDb() {
    const attemptUpdates: Record<string, unknown>[] = [];
    const paymentInserts: Record<string, unknown>[] = [];
    const client = {
      update: (tbl: unknown) => ({
        set: (v: Record<string, unknown>) => ({
          where: () => {
            if (tbl === paymentAttempts) attemptUpdates.push(v);
            return Promise.resolve([]);
          },
        }),
      }),
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          paymentInserts.push(v);
          return { onConflictDoNothing: () => Promise.resolve(undefined) };
        },
      }),
      select: () => ({
        from: (tbl: unknown) => ({
          where: () => ({
            limit: () =>
              Promise.resolve(
                tbl === payments && paymentInserts.length > 0
                  ? [{ ...PAYMENT_ROW, ...paymentInserts[0], id: 'pay_t' }]
                  : [],
              ),
          }),
        }),
      }),
    };
    return {
      db: { client } as unknown as DbService,
      attemptUpdates,
      paymentInserts,
    };
  }

  it('settles a test-mode intent with a test_ signature, no chain and no provider, and publishes payment.succeeded', async () => {
    const { provider, handleIncomingSettlement } = makeProvider({
      status: 'complete',
    });
    const findById = jest.fn().mockResolvedValue(intent('test'));
    const transition = jest.fn().mockResolvedValue({});
    const { publisher, events } = makePublisher();
    const { db, attemptUpdates, paymentInserts } = makeSandboxDb();
    // Held as the mock rather than read back off the typed client, so the
    // assertion below names a function instead of an unbound method.
    const statusReads = jest.fn().mockResolvedValue([]);
    const solana = {
      getSignatureStatuses: statusReads,
    } as unknown as SolanaRpc;
    const service = makeService({
      db,
      solana,
      intents: { findById, transition } as unknown as PaymentIntentService,
      provider,
      publisher,
    });

    await service.settleTestMode('pi_t');

    expect(attemptUpdates[0]).toMatchObject({
      status: 'succeeded',
      txSignature: 'test_pi_t',
    });
    expect(paymentInserts[0]).toMatchObject({
      intentId: 'pi_t',
      txSignature: 'test_pi_t',
    });
    expect(
      (transition.mock.calls as unknown[][]).map((c) => [c[1], c[2]]),
    ).toEqual([
      ['authorized', 'settling'],
      ['settling', 'succeeded'],
    ]);
    expect(handleIncomingSettlement).not.toHaveBeenCalled();
    expect(statusReads).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0].topic).toBe('payment.succeeded');
    expect(events[0].payload).toMatchObject({
      intentId: 'pi_t',
      ngnSettledMinor: '1600000',
      providerTxRef: 'test_pi_t',
    });
  });

  it('refuses a live intent without writing anything', async () => {
    const { provider } = makeProvider({ status: 'complete' });
    const findById = jest.fn().mockResolvedValue(intent('live'));
    const transition = jest.fn();
    const { publisher, events } = makePublisher();
    const { db, attemptUpdates, paymentInserts } = makeSandboxDb();
    const service = makeService({
      db,
      intents: { findById, transition } as unknown as PaymentIntentService,
      provider,
      publisher,
    });

    await expect(service.settleTestMode('pi_t')).rejects.toMatchObject({
      code: 'LIVE_INTENT_ON_SIMULATED_PATH',
    });
    expect(attemptUpdates).toEqual([]);
    expect(paymentInserts).toEqual([]);
    expect(transition).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});

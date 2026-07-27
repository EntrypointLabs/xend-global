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
  ngnDisplayMinor: null,
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
      values: () => ({ onConflictDoNothing: () => Promise.resolve(undefined) }),
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

    it('reaper force-fails an aged authorized attempt with ATTEMPT_ABANDONED and publishes no event', async () => {
      const { provider } = makeProvider({ status: 'complete' });
      const { intents } = makeIntents();
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
      expect(publish).not.toHaveBeenCalled();
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
      const { intents } = makeIntents();
      const { publisher } = makePublisher();
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
    });
  });
});

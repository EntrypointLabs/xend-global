import { FundingExecutor, type FundingExecutionPort } from './funding-executor';
import {
  createFundingState,
  reduceFundingState,
  type FundingEvent,
} from './funding-state';
import type { ReservedFundingIntent } from './funding-store';

describe('durable funding executor', () => {
  function setup() {
    let intent = {
      id: 'intent',
      ownerId: 'alice',
      executionBinding: {
        payoutProvider: 'bank',
        payoutDestination: 'verified-recipient',
      },
      payoutActionReference: 'intent_payout',
      conversionActionReference: null,
      state: createFundingState({
        id: 'intent',
        destinationCurrency: 'NGN',
        nativeReservedMinor: '100',
        payoutMinor: '100',
        payoutActionReference: 'intent_payout',
      }),
    } as ReservedFundingIntent;
    const store = {
      get: jest.fn((owner: string) =>
        Promise.resolve(owner === 'alice' ? structuredClone(intent) : null),
      ),
      applyEventResult: jest.fn(
        (_owner: string, _id: string, event: FundingEvent) => {
          const prior = intent.state;
          const state = reduceFundingState(prior, event);
          intent = { ...intent, state };
          return Promise.resolve({
            intent: structuredClone(intent),
            applied: state !== prior,
          });
        },
      ),
    };
    const port = {
      provider: 'bank',
      environment: 'sandbox' as const,
      assertReady: jest.fn(() => Promise.resolve()),
      submit: jest.fn(() => Promise.resolve()),
      reconcile: jest.fn(() => Promise.resolve([] as FundingEvent[])),
    } satisfies FundingExecutionPort;
    const ports = { conversion: () => undefined, payout: () => port };
    return {
      store,
      port,
      ports,
      executor: new FundingExecutor(store, ports, 'sandbox'),
    };
  }
  it('missing signed authorization leaves payout ready for preparation', async () => {
    const f = setup();
    f.port.assertReady.mockRejectedValueOnce(new Error('SIGNATURE_REQUIRED'));
    await expect(f.executor.step('alice', 'intent')).rejects.toThrow(
      'SIGNATURE_REQUIRED',
    );
    expect((await f.store.get('alice'))?.state.status).toBe('ready_to_send');
    expect(f.port.submit).not.toHaveBeenCalled();
    await f.executor.step('alice', 'intent');
    expect(f.port.submit).toHaveBeenCalledTimes(1);
  });
  it('concurrent workers claim only one submission and never settle from its acknowledgment', async () => {
    const f = setup();
    await Promise.all([
      f.executor.step('alice', 'intent'),
      f.executor.step('alice', 'intent'),
    ]);
    expect(f.port.submit).toHaveBeenCalledTimes(1);
    expect((await f.store.get('alice'))?.state.status).toBe('sending');
  });
  it('uncertain submission is requeried after restart without resubmitting or releasing funds', async () => {
    const f = setup();
    f.port.submit.mockRejectedValueOnce(new Error('timeout'));
    expect((await f.executor.step('alice', 'intent')).state.status).toBe(
      'needs_attention',
    );
    const restarted = new FundingExecutor(f.store, f.ports, 'sandbox');
    await restarted.step('alice', 'intent');
    expect(f.port.submit).toHaveBeenCalledTimes(1);
    expect(f.port.reconcile).toHaveBeenCalledTimes(1);
  });
  it('crash after durable claim requires requery instead of another submission', async () => {
    const f = setup();
    await f.store.applyEventResult('alice', 'intent', {
      id: 'native',
      actionReference: 'intent_payout',
      type: 'native_funding_ready',
    });
    await f.store.applyEventResult('alice', 'intent', {
      id: 'started',
      actionReference: 'intent_payout',
      type: 'payout_started',
    });
    await f.executor.step('alice', 'intent');
    expect(f.port.submit).not.toHaveBeenCalled();
    expect(f.port.reconcile).toHaveBeenCalledTimes(1);
  });
  it('accepts only matching reconciled payout evidence', async () => {
    const f = setup();
    await f.executor.step('alice', 'intent');
    f.port.reconcile.mockResolvedValueOnce([
      {
        id: 'confirmed',
        actionReference: 'wrong-action',
        type: 'payout_confirmed',
        evidence: {
          kind: 'bank_reconciliation',
          reference: 'bank-1',
          currency: 'NGN',
          amountMinor: '100',
        },
      },
    ]);
    await expect(f.executor.step('alice', 'intent')).rejects.toThrow(
      'RECONCILIATION_ACTION_MISMATCH',
    );
    f.port.reconcile.mockResolvedValueOnce([
      {
        id: 'confirmed',
        actionReference: 'intent_payout',
        type: 'payout_confirmed',
        evidence: {
          kind: 'bank_reconciliation',
          reference: 'bank-1',
          currency: 'NGN',
          amountMinor: '100',
        },
      },
    ]);
    expect((await f.executor.step('alice', 'intent')).state.status).toBe(
      'completed',
    );
  });
  it('rejects demo owners, wrong owners, and cross-environment ports', async () => {
    const f = setup();
    await expect(
      f.executor.step('local-unified-simulation', 'intent'),
    ).rejects.toThrow('SIMULATION_OWNER');
    await expect(f.executor.step('bob', 'intent')).rejects.toThrow('NOT_FOUND');
    await expect(
      new FundingExecutor(f.store, f.ports, 'live').step('alice', 'intent'),
    ).rejects.toThrow('PORT_UNAVAILABLE');
    expect(f.port.submit).not.toHaveBeenCalled();
  });
});

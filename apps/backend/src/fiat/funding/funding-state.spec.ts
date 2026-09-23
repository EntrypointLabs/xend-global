import {
  createFundingState,
  reduceFundingState,
  type FundingEvent,
  type FundingEvidence,
  type FundingState,
} from './funding-state';

const initial = () =>
  createFundingState({
    id: 'send-1',
    destinationCurrency: 'NGN',
    nativeReservedMinor: '50000000',
    payoutMinor: '60000000',
    payoutActionReference: 'payout-1',
    conversion: {
      actionReference: 'conversion-1',
      sourceCurrency: 'USDC',
      sourceMinor: '66666667',
      destinationMinor: '10000000',
    },
  });

const source: FundingEvent = {
  id: 'debit',
  type: 'conversion_source_debited',
  actionReference: 'conversion-1',
  evidence: {
    kind: 'onchain_finality',
    reference: 'confirmed-solana-tx',
    currency: 'USDC',
    amountMinor: '66666667',
  },
};
const destination: FundingEvent = {
  id: 'credit',
  type: 'conversion_destination_confirmed',
  actionReference: 'conversion-1',
  evidence: {
    kind: 'bank_reconciliation',
    reference: 'bank-credit-1',
    currency: 'NGN',
    amountMinor: '10000000',
  },
};
const start: FundingEvent = {
  id: 'start',
  type: 'conversion_started',
  actionReference: 'conversion-1',
};
const payoutStart: FundingEvent = {
  id: 'payout-start',
  type: 'payout_started',
  actionReference: 'payout-1',
};
const payoutDone: FundingEvent = {
  id: 'payout-done',
  type: 'payout_confirmed',
  actionReference: 'payout-1',
  evidence: {
    kind: 'bank_reconciliation',
    reference: 'bank-delivery-1',
    currency: 'NGN',
    amountMinor: '60000000',
  },
};
const apply = (state: FundingState, ...events: FundingEvent[]) =>
  events.reduce(reduceFundingState, state);

describe('unified send settlement state', () => {
  it('requires source debit and destination credit before sending combined NGN', () => {
    const before = initial();
    const debited = apply(before, start, source);
    expect(debited.conversion?.sourceDebited).toBe(true);
    expect(debited.conversion?.destinationConfirmed).toBe(false);
    expect(() => apply(debited, payoutStart)).toThrow('funding is not settled');
    const completed = apply(debited, destination, payoutStart, payoutDone);
    expect(completed.status).toBe('completed');
    expect(before.status).toBe('reserved');
    expect(before.conversion?.sourceDebited).toBe(false);
    expect(before.processedEvents).toEqual({});
  });

  it('holds destination credit until delayed source reconciliation arrives', () => {
    const credited = apply(initial(), start, destination);
    expect(credited.status).toBe('converting');
    expect(credited.conversion?.sourceDebited).toBe(false);
    expect(() => apply(credited, payoutStart)).toThrow();
    expect(apply(credited, source).status).toBe('ready_to_send');
  });

  it('replays duplicate IDs without changes and rejects changed duplicate contents', () => {
    const completed = apply(
      initial(),
      start,
      source,
      destination,
      payoutStart,
      payoutDone,
    );
    expect(apply(completed, source)).toBe(completed);
    expect(apply(completed, payoutDone)).toBe(completed);
    expect(() =>
      apply(completed, { ...source, actionReference: 'different' }),
    ).toThrow('reused with different contents');
    expect(() => apply(completed, { ...payoutDone, id: 'another' })).toThrow(
      'terminal',
    );
  });

  it('uses canonical event contents independent of object property order', () => {
    const state = apply(initial(), start);
    expect(
      apply(state, {
        type: 'conversion_started',
        actionReference: 'conversion-1',
        id: 'start',
      }),
    ).toBe(state);
  });

  it('recovers unknown conversion only using the pinned action', () => {
    const uncertain = apply(initial(), start, {
      id: 'timeout',
      type: 'conversion_unknown',
      actionReference: 'conversion-1',
    });
    expect(uncertain.status).toBe('needs_attention');
    expect(() =>
      apply(uncertain, { ...destination, actionReference: 'provider-2' }),
    ).toThrow('reference mismatch');
    expect(() => apply(uncertain, { ...start, id: 'retry-start' })).toThrow();
    expect(apply(uncertain, source, destination).status).toBe('ready_to_send');
  });

  it('keeps converted destination funds after reconciled final payout failure', () => {
    const failed = apply(initial(), start, source, destination, payoutStart, {
      id: 'failed',
      type: 'payout_not_debited',
      actionReference: 'payout-1',
      reconciliationReference: 'bank-rejection-1',
    });
    expect(failed.status).toBe('failed');
    expect(failed.conversion?.sourceDebited).toBe(true);
    expect(failed.conversion?.destinationConfirmed).toBe(true);
    expect(failed.failure).toBe('payout_not_debited');
    expect(failed.payoutEvidence).toBeUndefined();
  });

  it('does not treat payout timeout as failure or issue a second payout', () => {
    const uncertain = apply(
      initial(),
      start,
      source,
      destination,
      payoutStart,
      {
        id: 'payout-timeout',
        type: 'payout_unknown',
        actionReference: 'payout-1',
      },
    );
    expect(uncertain.status).toBe('needs_attention');
    expect(() => apply(uncertain, { ...payoutStart, id: 'retry' })).toThrow();
    expect(apply(uncertain, payoutDone).status).toBe('completed');
  });

  it('rejects releasing source reservations after source funds have moved', () => {
    const state = apply(initial(), start, source);
    expect(() =>
      apply(state, {
        id: 'failure',
        type: 'conversion_not_debited',
        actionReference: 'conversion-1',
        reconciliationReference: 'rejection',
      }),
    ).toThrow('cannot release funded conversion');
  });

  it('requires correct settlement evidence and rejects raw webhook or fixture evidence', () => {
    const state = apply(initial(), start, source, destination, payoutStart);
    for (const kind of ['webhook', 'simulation', 'onchain_finality']) {
      expect(() =>
        apply(state, {
          ...payoutDone,
          evidence: { ...payoutDone.evidence, kind } as FundingEvidence,
        }),
      ).toThrow('reconciliation evidence');
    }
    expect(() =>
      apply(state, {
        ...payoutDone,
        evidence: { ...payoutDone.evidence, amountMinor: '59999999' },
      }),
    ).toThrow('amount does not match');
  });

  it('sends native USDC without any conversion and requires finality', () => {
    const state = createFundingState({
      id: 'native',
      destinationCurrency: 'USDC',
      nativeReservedMinor: '80000000',
      payoutMinor: '80000000',
      payoutActionReference: 'payout-1',
    });
    expect(() => apply(state, start)).toThrow('does not require conversion');
    const done = apply(
      state,
      {
        id: 'ready',
        type: 'native_funding_ready',
        actionReference: 'payout-1',
      },
      payoutStart,
      {
        ...payoutDone,
        evidence: {
          kind: 'onchain_finality',
          reference: 'solana-final-tx',
          currency: 'USDC',
          amountMinor: '80000000',
        },
      },
    );
    expect(done.status).toBe('completed');
  });

  it('rejects underfunded intent and early completion without mutating reservations', () => {
    expect(() =>
      createFundingState({ ...initial(), payoutMinor: '70000000' }),
    ).toThrow('funding must cover');
    const state = initial();
    expect(() => apply(state, payoutDone)).toThrow('payout has not started');
    expect(() => apply(state, source)).toThrow('conversion has not started');
    expect(state.processedEvents).toEqual({});
  });
});

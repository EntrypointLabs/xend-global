/** Durable projection only: callers must atomically persist this with ledger reservations.
 * Evidence must come from an authenticated reconciliation worker, never request bodies.
 * This reducer neither authorises a spend nor changes a balance or submits a transfer.
 */
export type FundingStatus =
  | 'reserved'
  | 'converting'
  | 'ready_to_send'
  | 'sending'
  | 'completed'
  | 'failed'
  | 'needs_attention';

export type FundingCurrency = 'NGN' | 'USDC';
export type FundingEvidence = {
  kind: 'bank_reconciliation' | 'onchain_finality';
  reference: string;
  currency: FundingCurrency;
  amountMinor: string;
};

export type FundingState = {
  id: string;
  status: FundingStatus;
  destinationCurrency: FundingCurrency;
  /** Destination-denominated balance reserved before any conversion. */
  nativeReservedMinor: string;
  /** Total destination debit, including destination-denominated fees. */
  payoutMinor: string;
  payoutActionReference: string;
  payoutStarted: boolean;
  payoutEvidence?: FundingEvidence;
  conversion?: {
    actionReference: string;
    sourceCurrency: FundingCurrency;
    sourceMinor: string;
    destinationMinor: string;
    started: boolean;
    sourceDebited: boolean;
    destinationConfirmed: boolean;
    sourceEvidence?: FundingEvidence;
    destinationEvidence?: FundingEvidence;
  };
  attention?: 'conversion' | 'payout';
  /** Failure preserves confirmed destination funds; never implies reversing FX. */
  failure?: 'conversion_not_debited' | 'payout_not_debited';
  processedEvents: Record<string, string>;
};

type EventBase = { id: string; actionReference: string };
export type FundingEvent = EventBase &
  (
    | { type: 'conversion_started' }
    | { type: 'conversion_source_debited'; evidence: FundingEvidence }
    | { type: 'conversion_destination_confirmed'; evidence: FundingEvidence }
    | { type: 'conversion_unknown' }
    | { type: 'conversion_not_debited'; reconciliationReference: string }
    | { type: 'native_funding_ready' }
    | { type: 'payout_started' }
    | { type: 'payout_confirmed'; evidence: FundingEvidence }
    | { type: 'payout_unknown' }
    | { type: 'payout_not_debited'; reconciliationReference: string }
  );

export type CreateFundingState = {
  id: string;
  destinationCurrency: FundingCurrency;
  nativeReservedMinor: string;
  payoutMinor: string;
  payoutActionReference: string;
  conversion?: {
    actionReference: string;
    sourceCurrency: FundingCurrency;
    sourceMinor: string;
    destinationMinor: string;
  };
};

function requireCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(`Funding state conflict: ${message}`);
}

function amount(value: string, zeroAllowed = false): bigint {
  requireCondition(
    typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value),
    'amount must be a canonical integer in minor units',
  );
  const parsed = BigInt(value);
  requireCondition(zeroAllowed || parsed > 0n, 'amount must be positive');
  return parsed;
}

function nonempty(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function createFundingState(input: CreateFundingState): FundingState {
  requireCondition(nonempty(input.id), 'intent ID is required');
  requireCondition(
    nonempty(input.payoutActionReference),
    'stable payout reference is required before execution',
  );
  requireCondition(
    input.destinationCurrency === 'NGN' || input.destinationCurrency === 'USDC',
    'unsupported destination currency',
  );
  const native = amount(input.nativeReservedMinor, true);
  const payout = amount(input.payoutMinor);
  let converted = 0n;
  if (input.conversion) {
    const conversion = input.conversion;
    requireCondition(
      nonempty(conversion.actionReference) &&
        conversion.actionReference !== input.payoutActionReference,
      'conversion requires a distinct stable reference',
    );
    requireCondition(
      (conversion.sourceCurrency === 'NGN' ||
        conversion.sourceCurrency === 'USDC') &&
        conversion.sourceCurrency !== input.destinationCurrency,
      'conversion must use the other held currency',
    );
    amount(conversion.sourceMinor);
    converted = amount(conversion.destinationMinor);
  }
  requireCondition(
    native + converted >= payout,
    'funding must cover payout debit',
  );
  return {
    ...input,
    conversion: input.conversion
      ? {
          ...input.conversion,
          started: false,
          sourceDebited: false,
          destinationConfirmed: false,
        }
      : undefined,
    status: 'reserved',
    payoutStarted: false,
    processedEvents: {},
  };
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
}

function checkEvidence(
  evidence: FundingEvidence,
  currency: FundingCurrency,
  expectedMinor: string,
): void {
  requireCondition(
    evidence &&
      evidence.kind ===
        (currency === 'USDC' ? 'onchain_finality' : 'bank_reconciliation') &&
      nonempty(evidence.reference),
    'authenticated settlement reconciliation evidence is required',
  );
  requireCondition(
    evidence.currency === currency,
    'evidence currency mismatch',
  );
  requireCondition(
    amount(evidence.amountMinor) === amount(expectedMinor),
    'reconciled amount does not match reserved quote',
  );
}

/** Unknown results retain reservations. Retry/reconcile the same action reference;
 * never route an in-flight action to a replacement provider or reverse FX here.
 */
export function reduceFundingState(
  previous: FundingState,
  event: FundingEvent,
): FundingState {
  requireCondition(nonempty(event.id), 'event ID is required');
  const fingerprint = canonical(event);
  if (
    Object.prototype.hasOwnProperty.call(previous.processedEvents, event.id)
  ) {
    requireCondition(
      previous.processedEvents[event.id] === fingerprint,
      'event ID was reused with different contents',
    );
    return previous;
  }
  requireCondition(
    previous.status !== 'completed' && previous.status !== 'failed',
    'terminal intent cannot change',
  );
  const state: FundingState = {
    ...previous,
    conversion: previous.conversion ? { ...previous.conversion } : undefined,
    processedEvents: { ...previous.processedEvents, [event.id]: fingerprint },
  };
  const conversion = state.conversion;
  if (event.type.startsWith('conversion_')) {
    requireCondition(conversion, 'intent does not require conversion');
    requireCondition(
      event.actionReference === conversion.actionReference,
      'conversion reference mismatch',
    );
  } else {
    requireCondition(
      event.actionReference === state.payoutActionReference,
      'payout reference mismatch',
    );
  }
  const conversionPending = () => {
    requireCondition(conversion?.started, 'conversion has not started');
    requireCondition(
      state.status === 'converting' ||
        (state.status === 'needs_attention' &&
          state.attention === 'conversion'),
      'conversion update is out of order',
    );
  };
  const payoutPending = () => {
    requireCondition(state.payoutStarted, 'payout has not started');
    requireCondition(
      state.status === 'sending' ||
        (state.status === 'needs_attention' && state.attention === 'payout'),
      'payout update is out of order',
    );
  };
  switch (event.type) {
    case 'conversion_started':
      requireCondition(
        state.status === 'reserved',
        'conversion already started',
      );
      conversion!.started = true;
      state.status = 'converting';
      break;
    case 'conversion_source_debited':
    case 'conversion_destination_confirmed': {
      conversionPending();
      const source = event.type === 'conversion_source_debited';
      checkEvidence(
        event.evidence,
        source ? conversion!.sourceCurrency : state.destinationCurrency,
        source ? conversion!.sourceMinor : conversion!.destinationMinor,
      );
      if (source) {
        requireCondition(
          !conversion!.sourceDebited,
          'source debit already confirmed',
        );
        conversion!.sourceDebited = true;
        conversion!.sourceEvidence = { ...event.evidence };
      } else {
        requireCondition(
          !conversion!.destinationConfirmed,
          'destination credit already confirmed',
        );
        conversion!.destinationConfirmed = true;
        conversion!.destinationEvidence = { ...event.evidence };
      }
      if (conversion!.sourceDebited && conversion!.destinationConfirmed) {
        state.status = 'ready_to_send';
        state.attention = undefined;
      }
      break;
    }
    case 'conversion_unknown':
      conversionPending();
      state.status = 'needs_attention';
      state.attention = 'conversion';
      break;
    case 'conversion_not_debited':
      conversionPending();
      requireCondition(
        nonempty(event.reconciliationReference) &&
          !conversion!.sourceDebited &&
          !conversion!.destinationConfirmed,
        'cannot release funded conversion without reconciliation',
      );
      state.status = 'failed';
      state.failure = 'conversion_not_debited';
      state.attention = undefined;
      break;
    case 'native_funding_ready':
      requireCondition(
        state.status === 'reserved' && !conversion,
        'native funding cannot bypass required conversion',
      );
      state.status = 'ready_to_send';
      break;
    case 'payout_started':
      requireCondition(
        state.status === 'ready_to_send',
        'funding is not settled',
      );
      state.payoutStarted = true;
      state.status = 'sending';
      break;
    case 'payout_unknown':
      payoutPending();
      state.status = 'needs_attention';
      state.attention = 'payout';
      break;
    case 'payout_not_debited':
      payoutPending();
      requireCondition(
        nonempty(event.reconciliationReference),
        'confirmed non-debit reconciliation is required',
      );
      state.status = 'failed';
      state.failure = 'payout_not_debited';
      state.attention = undefined;
      break;
    case 'payout_confirmed':
      payoutPending();
      checkEvidence(
        event.evidence,
        state.destinationCurrency,
        state.payoutMinor,
      );
      state.payoutEvidence = { ...event.evidence };
      state.status = 'completed';
      state.attention = undefined;
      break;
    default:
      throw new Error('Funding state conflict: unknown event');
  }
  return state;
}

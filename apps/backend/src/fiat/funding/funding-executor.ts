import type { PgFundingStore, ReservedFundingIntent } from './funding-store';
import type { FundingEvent } from './funding-state';

/** Internal execution ports. No HTTP body can implement or supply these.
 * Reconciliation must query the pinned provider using the durable action reference,
 * authenticate the result and verify beneficiary, asset, network and exact amounts.
 * A submission response is not settlement evidence. Ports unable to requery after
 * losing a submission response must leave the intent needing attention.
 */
export interface FundingExecutionPort {
  readonly provider: string;
  readonly environment: 'sandbox' | 'live';
  /** Read-only preflight: firm quote valid, and for USDC an owned persisted
   * transfer binding plus required signatures must already exist. No movement. */
  assertReady(intent: ReservedFundingIntent): Promise<void>;
  submit(intent: ReservedFundingIntent): Promise<void>;
  reconcile(intent: ReservedFundingIntent): Promise<FundingEvent[]>;
}
export interface FundingExecutionPorts {
  conversion(provider: string): FundingExecutionPort | undefined;
  payout(provider: string): FundingExecutionPort | undefined;
}
export type FundingExecutionStore = Pick<
  PgFundingStore,
  'get' | 'applyEventResult'
>;

/** One recoverable step. Caller must authenticate/authorize intent creation first.
 * This executor has no default ports and cannot run simulation holdings.
 * Persist-before-submit gives at-most-one automatic submission attempt: a crash
 * in between requires provider requery/manual recovery, never blind resubmission.
 * USDC payout requires a separately authorized signed transaction; an adapter must
 * not substitute server custody for the Consumer's SpendService signing flow.
 */
export class FundingExecutor {
  constructor(
    private readonly store: FundingExecutionStore,
    private readonly ports: FundingExecutionPorts,
    private readonly environment: 'sandbox' | 'live',
  ) {}

  async step(ownerId: string, id: string): Promise<ReservedFundingIntent> {
    if (ownerId === 'local-unified-simulation')
      throw new Error('SIMULATION_OWNER_CANNOT_EXECUTE');
    let intent = await this.store.get(ownerId, id);
    if (!intent) throw new Error('FUNDING_INTENT_NOT_FOUND');
    if (intent.state.status === 'completed' || intent.state.status === 'failed')
      return intent;
    if (intent.state.status === 'reserved' && !intent.state.conversion) {
      intent = (
        await this.store.applyEventResult(ownerId, id, {
          id: `${intent.payoutActionReference}:native-ready`,
          type: 'native_funding_ready',
          actionReference: intent.payoutActionReference,
        })
      ).intent;
    }
    const conversion =
      intent.state.status === 'reserved' ||
      intent.state.status === 'converting' ||
      (intent.state.status === 'needs_attention' &&
        intent.state.attention === 'conversion');
    const provider = conversion
      ? intent.executionBinding.conversionProvider
      : intent.executionBinding.payoutProvider;
    const port =
      provider &&
      (conversion
        ? this.ports.conversion(provider)
        : this.ports.payout(provider));
    if (
      !port ||
      port.provider !== provider ||
      port.environment !== this.environment
    )
      throw new Error('VERIFIED_EXECUTION_PORT_UNAVAILABLE');
    const reference = conversion
      ? intent.conversionActionReference
      : intent.payoutActionReference;
    if (!reference) throw new Error('FUNDING_ACTION_REFERENCE_REQUIRED');
    const fresh = conversion
      ? intent.state.status === 'reserved'
      : intent.state.status === 'ready_to_send';
    if (fresh) {
      // Preparation/signature collection must precede the irreversible claim.
      await port.assertReady(intent);
      const claim = await this.store.applyEventResult(ownerId, id, {
        id: `${reference}:started`,
        actionReference: reference,
        type: conversion ? 'conversion_started' : 'payout_started',
      });
      intent = claim.intent;
      if (claim.applied) {
        try {
          await port.submit(intent);
        } catch {
          // Timeout/error does not prove non-debit. Keep reservations and query.
          await this.store.applyEventResult(ownerId, id, {
            id: `${reference}:submission-unknown`,
            actionReference: reference,
            type: conversion ? 'conversion_unknown' : 'payout_unknown',
          });
        }
      }
      // Requery on the next tick; do not confuse a submit acknowledgment with money.
      return (await this.store.get(ownerId, id))!;
    }
    const events = await port.reconcile(intent);
    const allowed = conversion
      ? new Set([
          'conversion_source_debited',
          'conversion_destination_confirmed',
          'conversion_unknown',
          'conversion_not_debited',
        ])
      : new Set(['payout_confirmed', 'payout_unknown', 'payout_not_debited']);
    for (const event of events) {
      if (event.actionReference !== reference || !allowed.has(event.type))
        throw new Error('RECONCILIATION_ACTION_MISMATCH');
    }
    for (const event of events) {
      intent = (await this.store.applyEventResult(ownerId, id, event)).intent;
    }
    return intent;
  }
}

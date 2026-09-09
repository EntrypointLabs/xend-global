import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  createFundingState,
  reduceFundingState,
  type FundingEvent,
  type FundingState,
} from './funding-state';
import {
  planFunding,
  type ConversionQuote,
  type FundingCurrency,
  type FundingPlan,
  type Holdings,
} from './funding-planner';

export interface FundingExecutionBinding {
  /** Internal validated beneficiary reference, never a client-selected settlement vault. */
  payoutDestination: string;
  payoutProvider: string;
  conversionProvider?: string;
  solana?: {
    network: 'devnet' | 'mainnet';
    mint: string;
    vaultAddress: string;
  };
}

export interface ReserveFundingRequest {
  ownerId: string;
  idempotencyKey: string;
  destinationCurrency: FundingCurrency;
  recipientMinor: string;
  payoutFeeMinor: string;
  /** Server-obtained executable quote; not an indicative valuation rate. */
  quote: ConversionQuote | null;
  executionBinding: FundingExecutionBinding;
}

export interface ReservedFundingIntent {
  id: string;
  ownerId: string;
  idempotencyKey: string;
  plan: FundingPlan;
  executionBinding: FundingExecutionBinding;
  payoutActionReference: string;
  conversionActionReference: string | null;
  holdingsReconciliationReference: string;
  holdingsReconciledAt: string;
  createdAt: string;
  state: FundingState;
}

interface HoldingsRow {
  ngn_settled: string;
  ngn_reserved: string;
  usdc_settled: string;
  usdc_reserved: string;
  reconciliation_reference: string;
  reconciled_at: Date;
}
interface IntentRow {
  id: string;
  owner_id: string;
  idempotency_key: string;
  request_hash: string;
  plan: FundingPlan;
  execution_binding: FundingExecutionBinding;
  payout_action_reference: string;
  conversion_action_reference: string | null;
  holdings_reconciliation_reference: string;
  holdings_reconciled_at: Date;
  created_at: Date;
  state: FundingState;
}

function mapIntent(row: IntentRow): ReservedFundingIntent {
  return {
    state: row.state,
    id: row.id,
    ownerId: row.owner_id,
    idempotencyKey: row.idempotency_key,
    plan: row.plan,
    executionBinding: row.execution_binding,
    payoutActionReference: row.payout_action_reference,
    conversionActionReference: row.conversion_action_reference,
    holdingsReconciliationReference: row.holdings_reconciliation_reference,
    holdingsReconciledAt: row.holdings_reconciled_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
}

/** No provider calls, balance ingestion, automatic schema creation, or spend authority.
 * A trusted reconciler owns settled holdings. All writers must lock the owner row.
 * Reserve and intent insert commit together. Unknown provider outcomes must not
 * release these reservations. Trusted events and holding deltas commit with an
 * append-only journal. No client request may supply settlement evidence.
 */
export class PgFundingStore {
  private readonly holdingsTable: string;
  private readonly intentsTable: string;
  private readonly journalTable: string;

  constructor(
    private readonly pool: Pool,
    namespace: string,
    /** Live ingestion must refresh holdings before this window expires. */
    private readonly maxReconciliationAgeMs = 30000,
  ) {
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(namespace)) {
      throw new Error('INVALID_FUNDING_SCHEMA');
    }
    if (
      !Number.isSafeInteger(maxReconciliationAgeMs) ||
      maxReconciliationAgeMs <= 0
    ) {
      throw new Error('INVALID_RECONCILIATION_MAX_AGE');
    }
    this.holdingsTable = `"${namespace}".funding_holdings`;
    this.intentsTable = `"${namespace}".funding_intents`;
    this.journalTable = `"${namespace}".funding_journal`;
  }

  async reserve(
    request: ReserveFundingRequest,
  ): Promise<ReservedFundingIntent> {
    if (
      !request.ownerId?.trim() ||
      !/^[\w:-]{8,100}$/.test(request.idempotencyKey) ||
      !request.executionBinding.payoutDestination?.trim() ||
      !request.executionBinding.payoutProvider?.trim()
    ) {
      throw new Error('INVALID_FUNDING_REQUEST');
    }
    // Copy before the first await so caller mutation cannot change a persisted plan
    // after its idempotency hash has been computed.
    const input = structuredClone(request);
    const hash = createHash('sha256').update(canonical(input)).digest('hex');
    return this.transaction(async (client) => {
      // Serialize both distinct intents and duplicate keys for this owner. Plan
      // only after the lock: caller/UI balances must never authorise a reservation.
      const locked = await client.query<HoldingsRow>(
        `SELECT * FROM ${this.holdingsTable} WHERE owner_id = $1 FOR UPDATE`,
        [input.ownerId],
      );
      const holdings = locked.rows[0];
      if (!holdings) throw new Error('RECONCILED_HOLDINGS_REQUIRED');
      const existing = await client.query<IntentRow>(
        `SELECT * FROM ${this.intentsTable} WHERE owner_id = $1 AND idempotency_key = $2`,
        [input.ownerId, input.idempotencyKey],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].request_hash !== hash) {
          throw new Error('FUNDING_IDEMPOTENCY_CONFLICT');
        }
        return mapIntent(existing.rows[0]);
      }
      const clock = await client.query<{ database_time: Date }>(
        'SELECT clock_timestamp() AS database_time',
      );
      const now = clock.rows[0].database_time.getTime();
      const age = now - holdings.reconciled_at.getTime();
      if (
        !Number.isFinite(age) ||
        age < 0 ||
        age > this.maxReconciliationAgeMs
      ) {
        throw new Error('FRESH_RECONCILED_HOLDINGS_REQUIRED');
      }
      const current: Holdings = {
        NGN: {
          settledMinor: holdings.ngn_settled,
          reservedMinor: holdings.ngn_reserved,
        },
        USDC: {
          settledMinor: holdings.usdc_settled,
          reservedMinor: holdings.usdc_reserved,
        },
      };
      const plan = planFunding(
        current,
        input.destinationCurrency,
        input.recipientMinor,
        input.payoutFeeMinor,
        input.quote,
        now,
      );
      if (
        plan.conversion &&
        !input.executionBinding.conversionProvider?.trim()
      ) {
        throw new Error('CONVERSION_PROVIDER_REQUIRED');
      }
      if (plan.conversion) {
        // This store is not live-wired. Each schema is one provider environment;
        // production must never share this quote namespace with sandbox.
        const used = await client.query(
          `SELECT id FROM ${this.intentsTable}
           WHERE conversion_provider = $1 AND conversion_quote_reference = $2`,
          [
            input.executionBinding.conversionProvider,
            plan.conversion.reference,
          ],
        );
        if (used.rowCount) throw new Error('CONVERSION_QUOTE_ALREADY_RESERVED');
      }
      const id = randomUUID();
      const payoutReference = `${id}_payout`;
      const conversionReference = plan.conversion ? `${id}_conversion` : null;
      await client.query(
        `UPDATE ${this.holdingsTable}
         SET ngn_reserved = ngn_reserved + $2::numeric,
             usdc_reserved = usdc_reserved + $3::numeric
         WHERE owner_id = $1`,
        [input.ownerId, plan.reservations.NGN, plan.reservations.USDC],
      );
      const state = createFundingState({
        id,
        destinationCurrency: plan.destinationCurrency,
        nativeReservedMinor: plan.directMinor,
        payoutMinor: (
          BigInt(plan.recipientMinor) + BigInt(plan.payoutFeeMinor)
        ).toString(),
        payoutActionReference: payoutReference,
        conversion: plan.conversion
          ? {
              actionReference: conversionReference!,
              sourceCurrency: plan.conversion.sourceCurrency,
              sourceMinor: plan.conversion.sourceDebitMinor,
              destinationMinor: plan.conversion.destinationCreditMinor,
            }
          : undefined,
      });
      const inserted = await client.query<IntentRow>(
        `INSERT INTO ${this.intentsTable}
         (id, owner_id, idempotency_key, request_hash, plan, execution_binding,
          payout_action_reference, conversion_action_reference,
          holdings_reconciliation_reference, holdings_reconciled_at,
          conversion_provider, conversion_quote_reference, state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [
          id,
          input.ownerId,
          input.idempotencyKey,
          hash,
          JSON.stringify(plan),
          JSON.stringify(input.executionBinding),
          payoutReference,
          conversionReference,
          holdings.reconciliation_reference,
          holdings.reconciled_at,
          plan.conversion ? input.executionBinding.conversionProvider : null,
          plan.conversion?.reference ?? null,
          JSON.stringify(state),
        ],
      );
      return mapIntent(inserted.rows[0]);
    });
  }

  async get(
    ownerId: string,
    id: string,
  ): Promise<ReservedFundingIntent | null> {
    const result = await this.pool.query<IntentRow>(
      `SELECT * FROM ${this.intentsTable} WHERE owner_id = $1 AND id = $2`,
      [ownerId, id],
    );
    return result.rows[0] ? mapIntent(result.rows[0]) : null;
  }

  /** Internal reconciler boundary: callers authenticate and bind evidence to the
   * pinned provider, action, owner and destination before invoking this method.
   * A webhook payload or provider submission response is not settlement evidence.
   */
  async applyEvent(
    ownerId: string,
    id: string,
    event: FundingEvent,
  ): Promise<ReservedFundingIntent> {
    return (await this.applyEventResult(ownerId, id, event)).intent;
  }

  /** Atomic claim result: only applied=true may initiate an external action. */
  async applyEventResult(
    ownerId: string,
    id: string,
    event: FundingEvent,
  ): Promise<{ intent: ReservedFundingIntent; applied: boolean }> {
    const input = structuredClone(event);
    return this.transaction(async (client) => {
      // Same lock order as reserve prevents owner overspend and transition races.
      const locked = await client.query<HoldingsRow>(
        `SELECT * FROM ${this.holdingsTable} WHERE owner_id = $1 FOR UPDATE`,
        [ownerId],
      );
      const found = await client.query<IntentRow>(
        `SELECT * FROM ${this.intentsTable} WHERE owner_id = $1 AND id = $2 FOR UPDATE`,
        [ownerId, id],
      );
      const row = found.rows[0];
      if (!row || !locked.rows[0]) throw new Error('FUNDING_INTENT_NOT_FOUND');
      const next = reduceFundingState(row.state, input);
      if (next === row.state) return { intent: mapIntent(row), applied: false };
      const delta = {
        NGN: { settled: 0n, reserved: 0n },
        USDC: { settled: 0n, reserved: 0n },
      };
      const destination = delta[next.destinationCurrency];
      switch (input.type) {
        case 'conversion_source_debited': {
          const source = delta[next.conversion!.sourceCurrency];
          source.settled -= BigInt(next.conversion!.sourceMinor);
          source.reserved -= BigInt(next.conversion!.sourceMinor);
          break;
        }
        case 'conversion_destination_confirmed':
          destination.settled += BigInt(next.conversion!.destinationMinor);
          // Quarantine the entire credit until both conversion legs are final.
          destination.reserved += BigInt(next.conversion!.destinationMinor);
          break;
        case 'conversion_not_debited':
          destination.reserved -= BigInt(next.nativeReservedMinor);
          delta[next.conversion!.sourceCurrency].reserved -= BigInt(
            next.conversion!.sourceMinor,
          );
          break;
        case 'payout_confirmed':
          destination.settled -= BigInt(next.payoutMinor);
          destination.reserved -= BigInt(next.payoutMinor);
          break;
        case 'payout_not_debited':
          destination.reserved -= BigInt(next.payoutMinor);
          break;
      }
      if (
        next.status === 'ready_to_send' &&
        row.state.status !== 'ready_to_send' &&
        next.conversion
      ) {
        destination.reserved -= BigInt(row.plan.surplusDestinationMinor);
      }
      const evidence = 'evidence' in input ? input.evidence : null;
      // Unique evidence prevents a reconciled movement crediting/debiting two intents.
      // Database triggers forbid journal UPDATE/DELETE; rollback preserves atomicity.
      await client.query(
        `INSERT INTO ${this.journalTable}
         (intent_id, event_id, event, state, deltas, evidence_kind, evidence_reference)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          id,
          input.id,
          JSON.stringify(input),
          JSON.stringify(next),
          JSON.stringify(delta, (_key, value: unknown) =>
            typeof value === 'bigint' ? value.toString() : value,
          ),
          evidence?.kind ?? null,
          evidence?.reference ?? null,
        ],
      );
      await client.query(
        `UPDATE ${this.holdingsTable} SET
          ngn_settled = ngn_settled + $2::numeric, ngn_reserved = ngn_reserved + $3::numeric,
          usdc_settled = usdc_settled + $4::numeric, usdc_reserved = usdc_reserved + $5::numeric
         WHERE owner_id = $1`,
        [
          ownerId,
          delta.NGN.settled.toString(),
          delta.NGN.reserved.toString(),
          delta.USDC.settled.toString(),
          delta.USDC.reserved.toString(),
        ],
      );
      const updated = await client.query<IntentRow>(
        `UPDATE ${this.intentsTable} SET state = $3 WHERE owner_id = $1 AND id = $2 RETURNING *`,
        [ownerId, id, JSON.stringify(next)],
      );
      return { intent: mapIntent(updated.rows[0]), applied: true };
    });
  }

  private async transaction<T>(
    execute: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await execute(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

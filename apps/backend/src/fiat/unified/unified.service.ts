import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { sql } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import {
  available,
  fundingRequirement,
  planFunding,
  planSendAll,
  valueHoldings,
} from '../funding/funding-planner';
import type {
  ConversionQuote,
  FundingCurrency,
  Holdings,
} from '../funding/funding-planner';
import type {
  AdvanceInput,
  OrderInput,
  QuoteInput,
  ReceiveInput,
  UnifiedAggregate,
  UnifiedOrder,
  UnifiedQuote,
  UnifiedRecord,
} from './unified.types';

const emptyHoldings = (): Holdings => ({
  NGN: { settledMinor: '0', reservedMinor: '0' },
  USDC: { settledMinor: '0', reservedMinor: '0' },
});
const ttl = 600000;

/** Entirely isolated demo aggregate. No real provider, custody, or ledger access. */
@Injectable()
export class UnifiedFiatService {
  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
  ) {}

  private gate() {
    const enabled = this.config.get<string | boolean>(
      'FIAT_UNIFIED_SIMULATION',
    );
    if (
      this.config.get<string>('NODE_ENV') === 'production' ||
      (enabled !== true && enabled !== 'true')
    ) {
      throw new ServiceUnavailableException(
        'Unified simulation is unavailable.',
      );
    }
  }

  private async transaction<T>(
    ownerId: string,
    run: (aggregate: UnifiedAggregate) => T,
  ): Promise<T> {
    this.gate();
    return this.db.client.transaction(async (tx) => {
      await tx.execute(sql`INSERT INTO fiat_unified_wallets (owner_id, holdings, records)
        VALUES (${ownerId}, ${JSON.stringify(emptyHoldings())}::jsonb, '[]'::jsonb)
        ON CONFLICT (owner_id) DO NOTHING`);
      const result = await tx.execute(
        sql`SELECT holdings, records FROM fiat_unified_wallets WHERE owner_id = ${ownerId} FOR UPDATE`,
      );
      const aggregate = result.rows[0] as unknown as UnifiedAggregate;
      let response: T;
      try {
        response = run(aggregate);
        for (const currency of ['NGN', 'USDC'] as const) {
          if (
            BigInt(aggregate.holdings[currency].settledMinor) < 0n ||
            BigInt(aggregate.holdings[currency].reservedMinor) < 0n
          )
            throw new Error('NEGATIVE_HOLDINGS');
          available(aggregate.holdings, currency);
        }
      } catch (error) {
        if (
          error instanceof NotFoundException ||
          error instanceof ConflictException
        )
          throw error;
        throw new ConflictException(
          error instanceof Error
            ? error.message
            : 'Simulation transition failed.',
        );
      }
      await tx.execute(
        sql`UPDATE fiat_unified_wallets SET holdings = ${JSON.stringify(aggregate.holdings)}::jsonb, records = ${JSON.stringify(aggregate.records)}::jsonb WHERE owner_id = ${ownerId}`,
      );
      return response;
    });
  }

  private snapshotOf(aggregate: UnifiedAggregate, currency: 'USD' | 'NGN') {
    const now = Date.now();
    return {
      mode: 'simulation' as const,
      holdings: structuredClone(aggregate.holdings),
      total: valueHoldings(
        aggregate.holdings,
        currency,
        {
          ngnNumerator: '1',
          usdcDenominator: '6',
          asOf: new Date(now).toISOString(),
          expiresAt: new Date(now + ttl).toISOString(),
        },
        now,
      ),
      orders: aggregate.records
        .filter(
          (record): record is Extract<UnifiedRecord, { kind: 'order' }> =>
            record.kind === 'order',
        )
        .map((record) => structuredClone(record.order))
        .reverse(),
    };
  }

  snapshot(ownerId: string, displayCurrency: 'USD' | 'NGN' = 'USD') {
    return this.transaction(ownerId, (aggregate) =>
      this.snapshotOf(aggregate, displayCurrency),
    );
  }

  private once<T>(
    aggregate: UnifiedAggregate,
    key: string,
    payload: unknown,
    action: () => T,
  ): T {
    const hash = createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');
    const old = aggregate.records.find(
      (record): record is Extract<UnifiedRecord, { kind: 'mutation' }> =>
        record.kind === 'mutation' && record.key === key,
    );
    if (old) {
      if (old.hash !== hash)
        throw new ConflictException(
          'Idempotency key already used for a different request.',
        );
      return structuredClone(old.response) as T;
    }
    const response = action();
    aggregate.records.push({
      kind: 'mutation',
      key,
      hash,
      response: structuredClone(response),
    });
    return response;
  }

  receive(ownerId: string, input: ReceiveInput) {
    return this.transaction(ownerId, (aggregate) =>
      this.once(
        aggregate,
        input.idempotencyKey,
        ['receive', input.currency, input.amountMinor],
        () => {
          const holding = aggregate.holdings[input.currency];
          holding.settledMinor = (
            BigInt(holding.settledMinor) + BigInt(input.amountMinor)
          ).toString();
          return this.snapshotOf(aggregate, 'USD');
        },
      ),
    );
  }

  private fixtureQuote(
    source: FundingCurrency,
    destination: FundingCurrency,
    sourceDebit: bigint,
    destinationCredit: bigint,
  ): ConversionQuote {
    return {
      reference: `simulation-${randomUUID()}`,
      sourceCurrency: source,
      destinationCurrency: destination,
      sourceDebitMinor: sourceDebit.toString(),
      destinationCreditMinor: destinationCredit.toString(),
      expiresAt: new Date(Date.now() + ttl).toISOString(),
    };
  }

  quote(ownerId: string, input: QuoteInput): Promise<UnifiedQuote> {
    return this.transaction(ownerId, (aggregate) => {
      const source = input.destinationCurrency === 'NGN' ? 'USDC' : 'NGN';
      let conversion: ConversionQuote | null = null;
      if (input.sendAll) {
        const debit = available(aggregate.holdings, source);
        if (debit > 0n)
          conversion = this.fixtureQuote(
            source,
            input.destinationCurrency,
            debit,
            source === 'NGN' ? debit * 6n : debit / 6n,
          );
      } else {
        const need = fundingRequirement(
          aggregate.holdings,
          input.destinationCurrency,
          input.recipientMinor!,
          '0',
        );
        const credit = BigInt(need.shortfallMinor);
        if (credit > 0n)
          conversion = this.fixtureQuote(
            source,
            input.destinationCurrency,
            source === 'NGN' ? (credit + 5n) / 6n : credit * 6n,
            credit,
          );
      }
      const plan = input.sendAll
        ? planSendAll(
            aggregate.holdings,
            input.destinationCurrency,
            '0',
            conversion,
          )
        : planFunding(
            aggregate.holdings,
            input.destinationCurrency,
            input.recipientMinor!,
            '0',
            conversion,
          );
      const quote: UnifiedQuote = {
        id: randomUUID(),
        plan,
        destination: input.destination,
        expiresAt: new Date(Date.now() + ttl).toISOString(),
        mode: 'simulation',
      };
      aggregate.records.push({ kind: 'quote', quote, input });
      return structuredClone(quote);
    });
  }

  order(ownerId: string, input: OrderInput): Promise<UnifiedOrder> {
    return this.transaction(ownerId, (aggregate) =>
      this.once(
        aggregate,
        input.idempotencyKey,
        ['order', input.quoteId, input.autoAdvance ?? false],
        () => {
          const record = aggregate.records.find(
            (row): row is Extract<UnifiedRecord, { kind: 'quote' }> =>
              row.kind === 'quote' && row.quote.id === input.quoteId,
          );
          if (!record) throw new NotFoundException('Quote not found.');
          if (record.orderId)
            throw new ConflictException('Quote already used.');
          if (Date.parse(record.quote.expiresAt) <= Date.now())
            throw new ConflictException('Quote expired.');
          const quoted = record.quote.plan;
          const plan = record.input.sendAll
            ? planSendAll(
                aggregate.holdings,
                quoted.destinationCurrency,
                '0',
                quoted.conversion,
              )
            : planFunding(
                aggregate.holdings,
                quoted.destinationCurrency,
                quoted.recipientMinor,
                '0',
                quoted.conversion,
              );
          if (!isDeepStrictEqual(plan, quoted))
            throw new ConflictException(
              'Holdings changed; request a fresh quote.',
            );
          for (const currency of ['NGN', 'USDC'] as const)
            aggregate.holdings[currency].reservedMinor = (
              BigInt(aggregate.holdings[currency].reservedMinor) +
              BigInt(plan.reservations[currency])
            ).toString();
          const now = new Date().toISOString();
          const order: UnifiedOrder = {
            autoAdvance: input.autoAdvance ?? false,
            id: randomUUID(),
            plan,
            destination: record.quote.destination,
            mode: 'simulation',
            status: plan.conversion ? 'converting' : 'ready_to_send',
            createdAt: now,
            updatedAt: now,
          };
          record.orderId = order.id;
          aggregate.records.push({ kind: 'order', order, converted: false });
          return structuredClone(order);
        },
      ),
    );
  }

  advance(
    ownerId: string,
    id: string,
    input: AdvanceInput,
    expectedStatus?: UnifiedOrder['status'],
  ): Promise<UnifiedOrder> {
    return this.transaction(ownerId, (aggregate) =>
      this.once(
        aggregate,
        input.idempotencyKey,
        ['advance', id, input.action],
        () => {
          const record = aggregate.records.find(
            (row): row is Extract<UnifiedRecord, { kind: 'order' }> =>
              row.kind === 'order' && row.order.id === id,
          );
          if (!record) throw new NotFoundException('Order not found.');
          const order = record.order;
          if (expectedStatus && order.status !== expectedStatus) {
            throw new ConflictException('Order already advanced.');
          }
          if (order.status === 'completed' || order.status === 'failed')
            throw new ConflictException('Order is terminal.');
          const conversion = order.plan.conversion;
          const destination =
            aggregate.holdings[order.plan.destinationCurrency];
          const payout =
            BigInt(order.plan.recipientMinor) +
            BigInt(order.plan.payoutFeeMinor);
          if (input.action === 'fail') {
            if (record.converted) {
              destination.reservedMinor = (
                BigInt(destination.reservedMinor) - payout
              ).toString();
            } else {
              for (const currency of ['NGN', 'USDC'] as const)
                aggregate.holdings[currency].reservedMinor = (
                  BigInt(aggregate.holdings[currency].reservedMinor) -
                  BigInt(order.plan.reservations[currency])
                ).toString();
            }
            order.status = 'failed';
          } else if (order.status === 'converting' && conversion) {
            const source = aggregate.holdings[conversion.sourceCurrency];
            source.settledMinor = (
              BigInt(source.settledMinor) - BigInt(conversion.sourceDebitMinor)
            ).toString();
            source.reservedMinor = (
              BigInt(source.reservedMinor) - BigInt(conversion.sourceDebitMinor)
            ).toString();
            destination.settledMinor = (
              BigInt(destination.settledMinor) +
              BigInt(conversion.destinationCreditMinor)
            ).toString();
            destination.reservedMinor = (
              BigInt(destination.reservedMinor) +
              BigInt(order.plan.shortfallMinor)
            ).toString();
            record.converted = true;
            order.status = 'ready_to_send';
          } else if (order.status === 'ready_to_send') {
            order.status = 'sending';
          } else if (order.status === 'sending') {
            destination.settledMinor = (
              BigInt(destination.settledMinor) - payout
            ).toString();
            destination.reservedMinor = (
              BigInt(destination.reservedMinor) - payout
            ).toString();
            order.status = 'completed';
          } else throw new ConflictException('Invalid transition.');
          order.updatedAt = new Date().toISOString();
          return structuredClone(order);
        },
      ),
    );
  }
  async tickAuto(): Promise<void> {
    try {
      this.gate();
    } catch {
      return;
    }
    const result = await this.db.client.execute(sql`
      SELECT owner_id, records FROM fiat_unified_wallets
      WHERE jsonb_path_exists(records, '$[*] ? (@.kind == "order" && @.order.autoAdvance == true && (@.order.status == "converting" || @.order.status == "ready_to_send" || @.order.status == "sending"))')
      ORDER BY owner_id LIMIT 100`);
    for (const value of result.rows) {
      const row = value as unknown as {
        owner_id: string;
        records: UnifiedRecord[];
      };
      const pending = row.records.filter(
        (record): record is Extract<UnifiedRecord, { kind: 'order' }> =>
          record.kind === 'order' &&
          record.order.autoAdvance &&
          ['converting', 'ready_to_send', 'sending'].includes(
            record.order.status,
          ),
      );
      for (const { order } of pending.slice(0, 20)) {
        try {
          await this.advance(
            row.owner_id,
            order.id,
            {
              idempotencyKey: `worker_${order.id}_${order.status}`,
              action: 'advance',
            },
            order.status,
          );
        } catch (error) {
          // Another worker/manual transition may have already settled this phase.
          if (!(error instanceof ConflictException)) throw error;
        }
      }
    }
  }
}

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TokenNamer } from '../tokens/token-namer.service';
import { TOKEN_PRICE_PROVIDER } from '../prices/token-price.interface';
import type { TokenPriceProvider } from '../prices/token-price.interface';
import type { ConfirmedTransferEvent } from '../solana/solana-rpc.interface';
import type { WalletAddress } from '../wallet/wallet-provider.interface';
import { RampActivityService } from '../fiat/ramp-activity';
import type { RampDetails } from '../fiat/ramp-activity';

/**
 * The write side of the activity feed. Called by both the webhook hot
 * path (WebhookController) and the boot-time replay (ReconcilerService).
 *
 * Status guard contract:
 *   - A row that is CONFIRMED or FAILED MUST NEVER regress to PENDING.
 *   - Encoded in SQL via a CASE expression in the ON CONFLICT DO UPDATE
 *     clause; encoded again in the reconciler's per-row WHERE clause.
 *   - This protects against late webhook deliveries that arrive after
 *     the reconciler has already finalized the row (or vice versa).
 *
 * Idempotency: a transfer is identified by its whole leg — signature, mint,
 * both addresses, amount, and the ordinal that separates legs identical in all
 * of those — and the single write path is
 * `INSERT ... ON CONFLICT (that key) DO UPDATE`, so duplicate webhook
 * deliveries collapse into a single row while the several legs of one
 * transaction stay several rows.
 */
@Injectable()
export class TailerService {
  private readonly logger = new Logger(TailerService.name);

  constructor(
    private readonly db: DbService,
    @Inject(TOKEN_PRICE_PROVIDER) private readonly prices: TokenPriceProvider,
    private readonly notifications: NotificationsService,
    private readonly namer: TokenNamer,
    @Optional() private readonly ramps?: RampActivityService,
  ) {}

  /**
   * What this transfer was worth, in dollars, right now.
   *
   * Stamped once and never recomputed: five SOL received while SOL was $100 is
   * $500 forever, because $500 is what changed hands. Re-pricing on read would
   * rewrite a Consumer's history every time the market moved.
   *
   * Returns null when the mint cannot be priced or its decimals are unknown,
   * because a raw amount without decimals is not a quantity yet.
   */
  private async usdValueAt(
    mint: string,
    amountRaw: bigint,
    eventDecimals: number | null,
  ): Promise<string | null> {
    try {
      const quote = (await this.prices.getUsdPrices([mint])).get(mint);
      // The chain's own decimals first: they are authoritative and present even
      // for mints no price index lists. Refusing to value a transfer just
      // because the quote omitted decimals left rows permanently unvalued that
      // the balance endpoint could price perfectly well.
      const decimals = eventDecimals ?? quote?.decimals ?? null;
      if (!quote || decimals === null) return null;

      const divisor = 10n ** BigInt(decimals);
      const whole = Number(amountRaw / divisor);
      const fraction = Number(amountRaw % divisor) / Number(divisor);
      return ((whole + fraction) * quote.usdPrice).toFixed(6);
    } catch (err) {
      // A price outage must not cost us the transfer row itself.
      this.logger.warn(`tailer.price.unavailable mint=${mint}`, err);
      return null;
    }
  }

  /**
   * @param smartAccountId the smart_accounts.id of the OWNED wallet that
   *   this event belongs to (sender or receiver). The caller already
   *   verified the wallet is ours and looked up its id.
   * @returns the resolved direction ('SEND' or 'RECEIVE').
   */
  async upsertConfirmedTransfer(
    evt: ConfirmedTransferEvent,
    smartAccountId: string,
    ownedWallet: WalletAddress,
  ): Promise<'SEND' | 'RECEIVE'> {
    const direction: 'SEND' | 'RECEIVE' =
      evt.fromAddress === ownedWallet ? 'SEND' : 'RECEIVE';

    // Correlate the confirmed transfer to a Payment by SIGNATURE (the only
    // stable join key across settlement providers; the destination at best
    // identifies the Merchant endpoint, never the individual Payment). If a
    // payments row exists for this settlement signature, the Consumer's
    // Activity row is a Payment. Convergent with finalizeSucceeded: whichever
    // runs once both rows exist writes the same linkage.
    const correlation = (await this.db.client.execute(sql`
      SELECT pay.id AS payment_id
      FROM payment_attempts pa
      JOIN payment_intents pi ON pi.id = pa.intent_id
      JOIN payments pay ON pay.intent_id = pi.id
      WHERE pa.tx_signature = ${evt.signature}
      LIMIT 1
    `)) as unknown as { rows: { payment_id: string }[] };
    const paymentId = correlation.rows[0]?.payment_id ?? null;
    const kind: 'transfer' | 'payment' = paymentId ? 'payment' : 'transfer';

    const usdValue = await this.usdValueAt(
      evt.mint,
      evt.amountRaw,
      evt.decimals,
    );

    // The CASE in the DO UPDATE clause is the load-bearing status guard:
    // if the existing row is already CONFIRMED or FAILED, keep that
    // status (do not regress); otherwise take the incoming status.
    // confirmed_at and slot use COALESCE so an existing non-null value
    // wins over an incoming one — this preserves the first confirmation
    // timestamp / slot when a duplicate event arrives.
    // `xmax = 0` is true only for a row this statement inserted; a conflict
    // that took the update path leaves it non-zero. That distinction is what
    // keeps a redelivered webhook, or a replay of the same signature, from
    // announcing the same arrival twice.
    const written = (await this.db.client.execute(sql`
      INSERT INTO transfers (
        id, smart_account_id, signature, direction, mint, amount_raw,
        from_address, to_address, status, slot, confirmed_at, created_at,
        kind, payment_id, decimals, usd_value, usd_priced_at, leg_index
      ) VALUES (
        ${this.generateId()},
        ${smartAccountId},
        ${evt.signature},
        ${direction}::transfer_direction,
        ${evt.mint},
        ${evt.amountRaw.toString()},
        ${evt.fromAddress},
        ${evt.toAddress},
        'CONFIRMED'::transfer_status,
        ${evt.slot.toString()}::bigint,
        ${evt.confirmedAt.toISOString()}::timestamp,
        NOW(),
        ${kind}::transfer_kind,
        ${paymentId},
        ${evt.decimals}::integer,
        ${usdValue}::numeric,
        ${usdValue === null ? null : new Date().toISOString()}::timestamp,
        ${evt.legIndex}::integer
      )
      ON CONFLICT (signature, mint, from_address, to_address, amount_raw, leg_index)
      DO UPDATE SET
        status = CASE
          WHEN transfers.status IN ('CONFIRMED', 'FAILED')
            THEN transfers.status
          ELSE EXCLUDED.status
        END,
        confirmed_at = COALESCE(transfers.confirmed_at, EXCLUDED.confirmed_at),
        slot = COALESCE(transfers.slot, EXCLUDED.slot),
        -- Promote to a Payment when this delivery carries a linkage; never
        -- regress a row that is already linked.
        kind = CASE
          WHEN EXCLUDED.payment_id IS NOT NULL THEN 'payment'::transfer_kind
          ELSE transfers.kind
        END,
        payment_id = COALESCE(transfers.payment_id, EXCLUDED.payment_id),
        -- First stamp wins. This is the whole point of storing the value:
        -- a later delivery of the same signature must not re-price history.
        decimals = COALESCE(transfers.decimals, EXCLUDED.decimals),
        usd_value = COALESCE(transfers.usd_value, EXCLUDED.usd_value),
        usd_priced_at = COALESCE(transfers.usd_priced_at, EXCLUDED.usd_priced_at)
      RETURNING id, created_at, (xmax = 0) AS inserted
    `)) as unknown as {
      rows: { id: string; created_at: Date | string; inserted: boolean }[];
    };
    const isNewRow = written.rows?.[0]?.inserted === true;

    // Update the per-wallet bookmark. Take MAX so out-of-order events
    // (rare; happens when the webhook delivers a slot newer than the
    // boot replay is processing) don't regress the cursor.
    await this.db.client.execute(sql`
      INSERT INTO tailer_state (wallet_address, last_indexed_slot, updated_at)
      VALUES (${ownedWallet}, ${evt.slot.toString()}::bigint, NOW())
      ON CONFLICT (wallet_address) DO UPDATE SET
        last_indexed_slot = GREATEST(
          tailer_state.last_indexed_slot,
          EXCLUDED.last_indexed_slot
        ),
        updated_at = NOW()
    `);

    // Only a genuinely new arrival is announced, and only an inbound one: a
    // Consumer knows about money they sent themselves.
    if (isNewRow && direction === 'RECEIVE') {
      // Caught here as well as inside the service. The transfer is already
      // written and the balance already moved; failing to mention it must not
      // turn a recorded arrival into a failed one.
      const symbol = await this.namer.symbolFor(evt.mint);
      // A naira deposit is told in naira: the Consumer paid ₦10,000 from their
      // bank, and "6.9 USDC" is not a sum they recognise.
      const row = written.rows[0];
      const ramp = await this.ramps?.forSmartAccount(smartAccountId, {
        id: row.id,
        direction: 'RECEIVE',
        mint: evt.mint,
        toAddress: evt.toAddress,
        signature: evt.signature,
        amountRaw: evt.amountRaw.toString(),
        decimals: evt.decimals,
        createdAt: new Date(row.created_at),
      });
      await this.notifications
        .notifyArrival({
          smartAccountId,
          amount: ramp
            ? describeRampArrival(ramp, evt)
            : describeAmount(evt, symbol),
        })
        .catch((err) => this.logger.warn('tailer.notify_failed', err));
    }

    return direction;
  }

  private generateId(): string {
    // The DB has a $defaultFn on the id column, but raw sql.execute
    // bypasses Drizzle's value generation, so mint one here. Kept
    // cuid2-shaped so rows are sortable by id and indistinguishable from
    // prepare/submit-written rows. Lazy-require so the dependency stays
    // optional in test contexts that mock the DB.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createId } = require('@paralleldrive/cuid2') as {
      createId: () => string;
    };
    return createId();
  }
}

/**
 * The arrival in the Consumer's terms: "5 SOL", "4.99 USDC", "1,234,567.5 USDC".
 *
 * Cut to two decimals rather than rounded, so a notice never claims more than
 * arrived. An amount under 0.01 keeps its first two significant digits
 * instead, or a small SOL arrival would read as "You received 0 SOL".
 *
 * Falls back to the raw amount when the chain did not report decimals, and to
 * the bare number when nothing could name the mint. Both are wrong-looking but
 * honest; inventing a scale or a ticker would be worse.
 */
function describeAmount(evt: ConfirmedTransferEvent, symbol: string): string {
  const dollars = symbol === 'USDC' && evt.decimals !== null;
  if (
    dollars &&
    evt.amountRaw >= 10n ** BigInt(Math.max((evt.decimals ?? 0) - 2, 0))
  )
    return describeDollars(evt.amountRaw, evt.decimals ?? 0);
  if (evt.decimals === null)
    return `${groupDigits(evt.amountRaw)} ${symbol}`.trim();

  const divisor = 10n ** BigInt(evt.decimals);
  const whole = evt.amountRaw / divisor;
  const digits = (evt.amountRaw % divisor)
    .toString()
    .padStart(evt.decimals, '0');
  const firstSignificant = digits.search(/[1-9]/);
  const kept =
    whole === 0n && firstSignificant >= DISPLAY_DECIMALS
      ? digits.slice(0, firstSignificant + 2)
      : digits.slice(0, DISPLAY_DECIMALS);
  const fraction = kept.replace(/0+$/, '');
  const amount = fraction
    ? `${groupDigits(whole)}.${fraction}`
    : groupDigits(whole);
  // Under a cent, dollars keep the significant digits rather than read $0.00.
  return dollars ? `$${amount}` : `${amount} ${symbol}`.trim();
}

const DISPLAY_DECIMALS = 2;

/** USDC as dollars, cut to cents so a notice never claims more than arrived. */
function describeDollars(amountRaw: bigint, decimals: number): string {
  const cents =
    decimals >= 2
      ? amountRaw / 10n ** BigInt(decimals - 2)
      : amountRaw * 10n ** BigInt(2 - decimals);
  return `$${groupDigits(cents / 100n)}.${(cents % 100n).toString().padStart(2, '0')}`;
}

/** "₦10,000 ($6.90)": the naira the Consumer sent, then what it became. */
function describeRampArrival(
  ramp: RampDetails,
  evt: ConfirmedTransferEvent,
): string {
  const scale = 10n ** BigInt(ramp.fiatDecimals);
  const minor = BigInt(ramp.fiatAmountMinor);
  const fraction = (minor % scale).toString().padStart(ramp.fiatDecimals, '0');
  const naira = `₦${groupDigits(minor / scale)}${/[1-9]/.test(fraction) ? `.${fraction}` : ''}`;
  return evt.decimals === null
    ? naira
    : `${naira} (${describeDollars(evt.amountRaw, evt.decimals)})`;
}

function groupDigits(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

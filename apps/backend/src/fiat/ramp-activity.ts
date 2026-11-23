import { Injectable, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { fiatOrders, smartAccounts, transfers } from '../db/schema';
import type { FiatMoney, FiatStatus } from './fiat-provider.interface';
import type { FiatOrder } from './fiat.types';
import { bankLogoKey } from './providers/paycrest/bank-logos';

/** What Activity needs to show a ramp transfer in naira rather than as a token move. */
export interface RampDetails {
  orderId: string;
  direction: 'receive' | 'send';
  /**
   * The order's own outcome. For a bank send the USDC leg can be confirmed
   * while the payout is still processing or has been returned.
   */
  orderStatus: FiatStatus;
  fiatCurrency: 'NGN';
  fiatAmountMinor: string;
  fiatDecimals: number;
  /** Naira per dollar at the order's quote, as a decimal string with two places. */
  rate: string | null;
  /** The partner's fee on top, in USDC minor units; null when there was none. */
  feeMinor: string | null;
  /** The person paid, for a send. A deposit's payer is not something we learn. */
  counterpartyName: string | null;
  bankName: string | null;
  bankCode: string | null;
  logoKey: string | null;
  accountLast4: string | null;
  /** Set on the arrival that brought a returned bank send's USDC back. */
  refund?: true;
}

export interface RampTransferRef {
  id: string;
  direction: 'SEND' | 'RECEIVE';
  mint: string;
  toAddress: string;
  signature: string | null;
  amountRaw: string;
  decimals: number | null;
  createdAt: Date;
}

// A deposit seen before its partner reported the signature is matched on
// amount and timing instead. Tight on both, so an unrelated arrival of a
// similar size is not taken for the naira.
const FALLBACK_WINDOW_MS = 2 * 60 * 60_000;
const FALLBACK_TOLERANCE_BPS = 200n;
const DEAD_ORDER = new Set(['expired', 'failed', 'returned', 'return_pending']);
// The lookup reaches this far either side of a page of transfers.
const LOOKUP_MARGIN_MS = 24 * 60 * 60_000;

function fiatLeg(order: FiatOrder): FiatMoney | null {
  const { quote, route } = order;
  if (route.direction === 'receive') {
    const naira = order.instructions.transferAmount ?? quote.debit;
    return naira.currency === 'NGN' ? naira : null;
  }
  return quote.credit.currency === 'NGN' ? quote.credit : null;
}

function usdcLeg(order: FiatOrder): FiatMoney | null {
  const leg =
    order.route.direction === 'receive'
      ? order.quote.credit
      : order.quote.debit;
  return leg.currency === 'USDC' ? leg : null;
}

/** Fiat minor per whole USDC, rounded down, rendered with the fiat's decimals. */
function rateOf(fiat: FiatMoney, usdc: FiatMoney): string | null {
  const usdcMinor = BigInt(usdc.amountMinor);
  if (usdcMinor === 0n) return null;
  const perUsdc =
    (BigInt(fiat.amountMinor) * 10n ** BigInt(usdc.decimals)) / usdcMinor;
  const scale = 10n ** BigInt(fiat.decimals);
  const fraction = (perUsdc % scale).toString().padStart(fiat.decimals, '0');
  return `${perUsdc / scale}.${fraction}`;
}

function feeOf(order: FiatOrder): string | null {
  if (order.route.direction === 'send') {
    const deposit = order.instructions.depositAmount;
    if (!deposit || deposit.currency !== 'USDC') return null;
    const fee =
      BigInt(deposit.amountMinor) - BigInt(order.quote.debit.amountMinor);
    return fee > 0n ? fee.toString() : null;
  }
  const fee = order.quote.fees
    .filter((f) => f.currency === 'USDC')
    .reduce((sum, f) => sum + BigInt(f.amountMinor), 0n);
  return fee > 0n ? fee.toString() : null;
}

export function rampDetails(order: FiatOrder): RampDetails | null {
  const fiat = fiatLeg(order);
  const usdc = usdcLeg(order);
  if (!fiat || !usdc) return null;
  const send = order.route.direction === 'send';
  const bankCode = send ? (order.instructions.payoutBankCode ?? null) : null;
  const accountNumber = send
    ? order.instructions.payoutAccountNumber
    : undefined;
  return {
    orderId: order.id,
    direction: order.route.direction,
    orderStatus: order.status,
    fiatCurrency: 'NGN',
    fiatAmountMinor: fiat.amountMinor,
    fiatDecimals: fiat.decimals,
    rate: rateOf(fiat, usdc),
    feeMinor: feeOf(order),
    counterpartyName: send
      ? (order.instructions.payoutAccountName ?? null)
      : null,
    bankName: send ? (order.instructions.payoutBankName ?? null) : null,
    bankCode,
    logoKey: bankCode ? bankLogoKey(bankCode) : null,
    accountLast4: accountNumber ? accountNumber.slice(-4) : null,
  };
}

function withinTolerance(actual: bigint, expected: bigint): boolean {
  const diff = actual > expected ? actual - expected : expected - actual;
  return diff * 10_000n <= expected * FALLBACK_TOLERANCE_BPS;
}

/**
 * Pairs on-chain transfers with the naira orders behind them.
 *
 * A bank send pays a deposit address opened for that order alone, so the
 * address is proof. A deposit is matched by the signature its partner reports,
 * or, before that report lands, by an arrival of the quoted size shortly after
 * the order was opened.
 */
export function matchRampOrders(
  transfers: RampTransferRef[],
  orders: FiatOrder[],
  usdcMint: string,
): Map<string, RampDetails> {
  const matched = new Map<string, RampDetails>();
  const claimed = new Set<string>();
  const live = orders.filter((o) => !o.simulation);

  const bySignature = new Map<string, FiatOrder>();
  const byDeposit = new Map<string, FiatOrder>();
  const byRefund = new Map<string, FiatOrder>();
  for (const order of live) {
    if (order.route.direction === 'send' && order.refundSignature)
      byRefund.set(order.refundSignature, order);
    if (order.route.direction === 'receive' && order.settlementSignature)
      bySignature.set(order.settlementSignature, order);
    if (order.route.direction === 'send' && order.instructions.depositAddress)
      byDeposit.set(order.instructions.depositAddress, order);
  }

  const claim = (transfer: RampTransferRef, order: FiatOrder) => {
    const details = rampDetails(order);
    if (!details) return;
    matched.set(transfer.id, details);
    claimed.add(order.id);
  };

  // Ramps only ever move USDC; any other token is never a naira leg.
  transfers = transfers.filter((t) => t.mint === usdcMint);

  for (const transfer of transfers) {
    const refunded =
      transfer.direction === 'RECEIVE' && transfer.signature
        ? byRefund.get(transfer.signature)
        : undefined;
    if (refunded) {
      const details = rampDetails(refunded);
      if (details) matched.set(transfer.id, { ...details, refund: true });
      continue;
    }
    const order =
      transfer.direction === 'SEND'
        ? byDeposit.get(transfer.toAddress)
        : transfer.signature
          ? bySignature.get(transfer.signature)
          : undefined;
    if (order && !claimed.has(order.id)) claim(transfer, order);
  }

  const waiting = live
    .filter(
      (o) =>
        o.route.direction === 'receive' &&
        !claimed.has(o.id) &&
        !o.settlementSignature &&
        !DEAD_ORDER.has(o.status),
    )
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const arrivals = transfers
    .filter((t) => t.direction === 'RECEIVE' && !matched.has(t.id))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const order of waiting) {
    const usdc = usdcLeg(order);
    if (!usdc) continue;
    const opened = Date.parse(order.createdAt);
    const hit = arrivals.find(
      (t) =>
        !matched.has(t.id) &&
        t.createdAt.getTime() >= opened &&
        t.createdAt.getTime() <= opened + FALLBACK_WINDOW_MS &&
        withinTolerance(BigInt(t.amountRaw), BigInt(usdc.amountMinor)),
    );
    if (hit) claim(hit, order);
  }
  return matched;
}

@Injectable()
export class RampActivityService {
  private readonly logger = new Logger(RampActivityService.name);

  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
  ) {}

  private get usdcMint(): string {
    return this.config.get<string>('EXPO_PUBLIC_USDC_MINT_ADDRESS') ?? '';
  }

  /**
   * Orders near these transfers in time, plus any order they match exactly by
   * signature or deposit address however old it is: PAJ keeps a deposit
   * account open for days, and a late payment still settles.
   */
  private async ordersFor(
    userId: string,
    refs: RampTransferRef[],
  ): Promise<FiatOrder[]> {
    const times = refs.map((t) => t.createdAt.getTime());
    const signatures = refs
      .map((t) => t.signature)
      .filter((v): v is string => !!v);
    const addresses = refs
      .filter((t) => t.direction === 'SEND')
      .map((t) => t.toAddress);
    const near = and(
      gte(
        fiatOrders.createdAt,
        new Date(Math.min(...times) - LOOKUP_MARGIN_MS),
      ),
      lte(fiatOrders.createdAt, new Date(Math.max(...times) + 60_000)),
    );
    const exact: SQL[] = [];
    if (signatures.length > 0)
      exact.push(
        inArray(sql`${fiatOrders.payload}->>'settlementSignature'`, signatures),
        inArray(sql`${fiatOrders.payload}->>'refundSignature'`, signatures),
      );
    if (addresses.length > 0)
      exact.push(
        inArray(
          sql`${fiatOrders.payload}->'instructions'->>'depositAddress'`,
          addresses,
        ),
      );
    const rows = await this.db.client
      .select({ payload: fiatOrders.payload })
      .from(fiatOrders)
      .where(and(eq(fiatOrders.userId, userId), or(near, ...exact)));
    return rows.map((r) => r.payload);
  }

  /**
   * Every USDC arrival a still-unreported deposit could be matched to.
   *
   * The fallback gives an order to the earliest fitting arrival. Deciding that
   * from one page, or from the single transfer a notice is about, would let
   * two reads give the same order to two different arrivals.
   */
  private async candidateArrivals(
    userId: string,
    waiting: FiatOrder[],
  ): Promise<RampTransferRef[]> {
    if (waiting.length === 0) return [];
    const opened = waiting.map((o) => Date.parse(o.createdAt));
    const rows = await this.db.client
      .select({
        id: transfers.id,
        direction: transfers.direction,
        mint: transfers.mint,
        toAddress: transfers.toAddress,
        signature: transfers.signature,
        amountRaw: transfers.amountRaw,
        decimals: transfers.decimals,
        createdAt: transfers.createdAt,
      })
      .from(transfers)
      .innerJoin(smartAccounts, eq(transfers.smartAccountId, smartAccounts.id))
      .where(
        and(
          eq(smartAccounts.userId, userId),
          eq(transfers.direction, 'RECEIVE'),
          eq(transfers.mint, this.usdcMint),
          gte(transfers.createdAt, new Date(Math.min(...opened))),
          lte(
            transfers.createdAt,
            new Date(Math.max(...opened) + FALLBACK_WINDOW_MS),
          ),
        ),
      );
    return rows;
  }

  /** Never fails a read: a ramp that cannot be matched renders as a transfer. */
  async forUser(
    userId: string,
    refs: RampTransferRef[],
  ): Promise<Map<string, RampDetails>> {
    if (refs.length === 0) return new Map();
    try {
      let orders = await this.ordersFor(userId, refs);
      const waiting = orders.filter(
        (o) =>
          !o.simulation &&
          o.route.direction === 'receive' &&
          !o.settlementSignature &&
          !DEAD_ORDER.has(o.status),
      );
      const extra = await this.candidateArrivals(userId, waiting);
      const all = new Map(refs.map((t) => [t.id, t]));
      for (const t of extra) if (!all.has(t.id)) all.set(t.id, t);
      if (extra.length > 0) {
        // An extra arrival may be another order's exact match; that order has
        // to be in hand or the fallback could take its transfer.
        const known = new Set(orders.map((o) => o.id));
        for (const o of await this.ordersFor(userId, extra))
          if (!known.has(o.id)) orders = [...orders, o];
      }
      const matched = matchRampOrders([...all.values()], orders, this.usdcMint);
      const result = new Map<string, RampDetails>();
      for (const t of refs) {
        const details = matched.get(t.id);
        if (details) result.set(t.id, details);
      }
      return result;
    } catch (err) {
      this.logger.warn('ramp.match_failed; activity renders as transfers', err);
      return new Map();
    }
  }

  async forSmartAccount(
    smartAccountId: string,
    transfer: RampTransferRef,
  ): Promise<RampDetails | null> {
    try {
      const [owner] = await this.db.client
        .select({ userId: smartAccounts.userId })
        .from(smartAccounts)
        .where(eq(smartAccounts.id, smartAccountId))
        .limit(1);
      if (!owner) return null;
      return (
        (await this.forUser(owner.userId, [transfer])).get(transfer.id) ?? null
      );
    } catch (err) {
      this.logger.warn('ramp.match_failed', err);
      return null;
    }
  }
}

/** Standalone so the transfers list and the arrival notice can share it without the fiat module's providers. */
@Module({
  providers: [RampActivityService],
  exports: [RampActivityService],
})
export class RampActivityModule {}

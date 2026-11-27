import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createId } from '@paralleldrive/cuid2';
import { FiatProviderRegistry } from './fiat-provider.registry';
import { FIAT_STORE } from './fiat.repository';
import type { FiatStore } from './fiat.repository';
import type {
  FiatOrderRequestBody,
  FiatQuoteRequestBody,
  FiatSimulationRequestBody,
} from './dtos';
import type { FiatOrder, FiatQuote, StoredFiatOrder } from './fiat.types';
import type { FiatDirection, FiatStatus } from './fiat-provider.interface';
import { FiatError } from './fiat.errors';
import { nextFiatStatus, providerFiatStatus } from './fiat-state';
import { FiatVerificationService } from './verification/verification.service';
import { ServerAnalytics } from '../analytics/server-analytics.service';
import type { ServerEventName } from '../analytics/server-events';
import { bucketNgnMinor } from '../analytics/redact';
import {
  DEFAULT_UNVERIFIED_LIMIT_NAIRA,
  LIMIT_WINDOW_MS,
  checkUnverifiedLimit,
  nairaMinorOf,
  usedNairaMinor,
  type LimitCheck,
} from './verification/limits';

const TERMINAL: ReadonlySet<FiatStatus> = new Set([
  'completed',
  'failed',
  'returned',
]);
const UNSUCCESSFUL: ReadonlySet<FiatStatus> = new Set([
  'failed',
  'expired',
  'returned',
]);
// PAJ deletes an unpaid deposit order after 72 hours; nothing can land later.
const PROVIDER_WATCH_MS = 72 * 60 * 60 * 1000;
const PROVIDER_POLL_MS = 10_000;
// A bank send's deposit can be refunded after Paycrest's 72h order window.
const SEND_WATCH_MS = 14 * 24 * 60 * 60 * 1000;

function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
@Injectable()
export class FiatService {
  private readonly logger = new Logger(FiatService.name);
  private readonly lastPolled = new Map<string, number>();

  constructor(
    private readonly registry: FiatProviderRegistry,
    @Inject(FIAT_STORE) private readonly store: FiatStore,
    @Optional() private readonly verification?: FiatVerificationService,
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly analytics?: ServerAnalytics,
  ) {}

  /**
   * `store.event` with the outcome reported. The reducer runs against the
   * locked row and only for an update not seen before, so a status it moves
   * is moved exactly once, whichever poll or callback got there.
   */
  private async transition(
    userId: string,
    orderId: string,
    key: string,
    eventHash: string,
    reduce: (order: FiatOrder) => FiatOrder,
  ): Promise<FiatOrder> {
    let from = null as FiatStatus | null;
    const result = await this.store.event(
      userId,
      orderId,
      key,
      eventHash,
      (order) => {
        const next = reduce(order);
        from = next.status === order.status ? null : order.status;
        return next;
      },
    );
    if (from) this.report(userId, result, from);
    return result;
  }

  /**
   * A naira deposit is a fiat order; a bank send is a payout. `from` is null
   * when the order was just created. Simulated orders move no money and are
   * left out.
   */
  private report(userId: string, order: FiatOrder, from: FiatStatus | null) {
    if (!this.analytics || order.simulation) return;
    const send = order.route.direction === 'send';
    let event: ServerEventName | null = null;
    if (order.status === 'completed') {
      event = send
        ? 'server_bank_payout_completed'
        : 'server_fiat_order_completed';
    } else if (
      UNSUCCESSFUL.has(order.status) &&
      !(from && UNSUCCESSFUL.has(from))
    ) {
      event = send ? 'server_bank_payout_failed' : 'server_fiat_order_failed';
    } else if (from === null && !send) {
      event = 'server_fiat_order_created';
    }
    if (!event) return;
    this.analytics.capture(
      event,
      { consumerId: userId },
      {
        provider: order.route.provider,
        amount_bucket: bucketNgnMinor(nairaMinorOf(order.quote)),
        currency: 'NGN',
        status: order.status,
        ...(from === null && event !== 'server_fiat_order_created'
          ? { step: 'create' }
          : {}),
      },
    );
  }

  private limitMinor(): bigint {
    const naira = Number(
      this.config?.get('FIAT_UNVERIFIED_LIMIT_NAIRA') ??
        DEFAULT_UNVERIFIED_LIMIT_NAIRA,
    );
    return BigInt(
      Math.round(
        (Number.isFinite(naira) && naira >= 0
          ? naira
          : DEFAULT_UNVERIFIED_LIMIT_NAIRA) * 100,
      ),
    );
  }

  private async limitCheck(
    userId: string,
    direction: FiatDirection,
    quote: Pick<FiatQuote, 'debit' | 'credit'>,
    customerId: string | null,
  ): Promise<LimitCheck> {
    const since = Date.now() - LIMIT_WINDOW_MS;
    const recent = await this.store.since(userId, new Date(since));
    return checkUnverifiedLimit({
      amountMinor: nairaMinorOf(quote),
      usedMinor: usedNairaMinor(recent, since, direction),
      limitMinor: this.limitMinor(),
      verified: customerId !== null,
    });
  }

  /** The Consumer's allowance before verification, for the amount screens. */
  async limits(userId: string) {
    const customerId =
      (await this.verification?.verifiedCustomerId(userId)) ?? null;
    const since = Date.now() - LIMIT_WINDOW_MS;
    const recent = await this.store.since(userId, new Date(since));
    const receive = usedNairaMinor(recent, since, 'receive');
    const send = usedNairaMinor(recent, since, 'send');
    return {
      verified: customerId !== null,
      limitMinor: this.limitMinor().toString(),
      used: { receive: receive.toString(), send: send.toString() },
      // Builds that predate the split read one figure for both screens. The
      // larger one keeps them from offering an amount the order would refuse.
      usedMinor: (receive > send ? receive : send).toString(),
      windowHours: LIMIT_WINDOW_MS / 3_600_000,
    };
  }
  async routes() {
    return { routes: await this.registry.routes() };
  }
  async quote(userId: string, input: FiatQuoteRequestBody): Promise<FiatQuote> {
    const route = await this.registry.route(input.routeId);
    if (!route.quoteAvailable)
      throw new FiatError('ROUTE_UNAVAILABLE', 'Quotes are unavailable.', 503);
    const side = input.side ?? 'debit';
    const quote = await this.registry
      .provider(route.provider)
      .quote(route, input.amountMinor, side);
    const validMoney = (money: {
      currency: string;
      amountMinor: string;
      decimals: number;
    }) =>
      money &&
      ['NGN', 'USDC'].includes(money.currency) &&
      money.decimals === (money.currency === 'NGN' ? 2 : 6) &&
      /^\d{1,30}$/.test(money.amountMinor);
    if (
      !validMoney(quote.debit) ||
      !validMoney(quote.credit) ||
      !Array.isArray(quote.fees) ||
      !quote.fees.every(validMoney)
    ) {
      throw new FiatError(
        'INVALID_PROVIDER_QUOTE',
        'The provider returned invalid money units.',
        502,
      );
    }
    if (
      !Number.isFinite(Date.parse(quote.expiresAt)) ||
      Date.parse(quote.expiresAt) <= Date.now() ||
      quote.debit.currency !== route.sourceCurrency ||
      quote.credit.currency !== route.destinationCurrency ||
      (side === 'debit'
        ? quote.debit.amountMinor !== input.amountMinor
        : quote.credit.amountMinor !== input.amountMinor) ||
      !/^[1-9]\d*$/.test(quote.credit.amountMinor) ||
      !/^[1-9]\d*$/.test(quote.debit.amountMinor)
    ) {
      throw new FiatError(
        'INVALID_PROVIDER_QUOTE',
        'The provider returned an unusable quote.',
        502,
      );
    }
    const verification =
      route.environment === 'simulation'
        ? undefined
        : await this.limitCheck(
            userId,
            route.direction,
            quote,
            (await this.verification?.verifiedCustomerId(userId)) ?? null,
          );
    const result: FiatQuote = {
      ...quote,
      id: createId(),
      route,
      ...(verification ? { verification } : {}),
    };
    await this.store.saveQuote(userId, result);
    return result;
  }
  async list(userId: string) {
    const orders = await this.store.list(userId);
    return {
      orders: await Promise.all(
        orders.map(async (order) => {
          try {
            return await this.refreshStale(userId, order);
          } catch {
            return order;
          }
        }),
      ),
    };
  }
  async order(userId: string, id: string) {
    const row = await this.store.order(userId, id);
    if (!row) throw new FiatError('ORDER_NOT_FOUND', 'Order not found.', 404);
    return this.refreshStale(userId, row.order);
  }
  private async refreshStale(userId: string, order: FiatOrder) {
    const local = await this.expireOrFlag(userId, order);
    return this.pollProvider(userId, local);
  }

  /**
   * Asks the provider for its current word on a live order. Throttled, and
   * never fatal: a failed read leaves the stored state as it was.
   */
  private async pollProvider(userId: string, order: FiatOrder) {
    // A returned send stays watched until the refund transfer is known, so
    // Activity can show that arrival as the refund it is.
    const awaitingRefund =
      order.status === 'returned' &&
      order.route.direction === 'send' &&
      !order.refundSignature;
    if (order.simulation || (TERMINAL.has(order.status) && !awaitingRefund))
      return order;
    const watch =
      order.route.direction === 'send' ? SEND_WATCH_MS : PROVIDER_WATCH_MS;
    if (Date.parse(order.createdAt) + watch <= Date.now()) return order;
    const last = this.lastPolled.get(order.id) ?? 0;
    if (Date.now() - last < PROVIDER_POLL_MS) return order;
    this.lastPolled.set(order.id, Date.now());
    const row = await this.store.order(userId, order.id);
    if (!row?.providerReference) return order;
    try {
      return await this.applyProvider(row);
    } catch (error) {
      this.logger.warn(
        `fiat.poll failed order=${order.id} ${error instanceof Error ? error.message : ''}`,
      );
      return order;
    }
  }

  /**
   * Reads the provider and records any change. Webhooks only trigger this:
   * the state always comes from an authenticated read, never a delivery body.
   */
  async refreshFromProvider(provider: string, reference: string) {
    const row = await this.store.byProviderReference(provider, reference);
    if (!row) return null;
    return this.applyProvider(row);
  }

  private async applyProvider(row: StoredFiatOrder) {
    const current = row.order;
    const reported = await this.registry
      .provider(current.route.provider)
      .getOrder(row.providerReference!);
    if (!reported) return current;
    const next = providerFiatStatus(current.status, reported.status);
    const newRefund =
      !!reported.refundSignature &&
      reported.refundSignature !== current.refundSignature;
    if (next === current.status && !newRefund) return current;
    return this.transition(
      row.userId,
      current.id,
      newRefund
        ? `provider:${reported.status}:${reported.refundSignature}`
        : `provider:${reported.status}`,
      hash(
        newRefund
          ? `${reported.status}:${reported.refundSignature}`
          : reported.status,
      ),
      (order) => {
        const status = providerFiatStatus(order.status, reported.status);
        const refund =
          reported.refundSignature &&
          reported.refundSignature !== order.refundSignature
            ? { refundSignature: reported.refundSignature }
            : null;
        return status === order.status && !refund
          ? order
          : {
              ...order,
              status,
              ...(reported.signature
                ? { settlementSignature: reported.signature }
                : {}),
              ...(refund ?? {}),
              updatedAt: new Date().toISOString(),
            };
      },
    );
  }

  private async expireOrFlag(userId: string, order: FiatOrder) {
    const staleCreation =
      order.status === 'creating' &&
      Date.parse(order.createdAt) + 30_000 <= Date.now();
    const expired =
      order.status === 'awaiting_payment' &&
      Date.parse(order.instructions.expiresAt ?? order.quote.expiresAt) <=
        Date.now();
    if (staleCreation || expired) {
      const event = staleCreation
        ? 'creation_uncertain'
        : 'instructions_expired';
      return this.transition(
        userId,
        order.id,
        `system:${event}`,
        hash(event),
        (current) => {
          if (current.status !== order.status) return current;
          return {
            ...current,
            status: staleCreation ? 'needs_attention' : 'expired',
            updatedAt: new Date().toISOString(),
          };
        },
      );
    }
    return order;
  }
  async create(userId: string, input: FiatOrderRequestBody) {
    const requestHash = hash([
      input.quoteId,
      Object.entries(input.fields).sort(([a], [b]) => a.localeCompare(b)),
    ]);
    const prior = await this.store.byKey(userId, input.idempotencyKey);
    if (prior) {
      if (prior.requestHash !== requestHash)
        throw new FiatError(
          'IDEMPOTENCY_CONFLICT',
          'This request key was used for a different order.',
          409,
        );
      return this.order(userId, prior.order.id);
    }
    const quote = await this.store.quote(userId, input.quoteId);
    if (!quote) throw new FiatError('QUOTE_NOT_FOUND', 'Quote not found.', 404);
    if (Date.parse(quote.expiresAt) <= Date.now())
      throw new FiatError(
        'QUOTE_EXPIRED',
        'Get a new quote before continuing.',
        410,
      );
    const route = await this.registry.route(quote.route.id);
    if (
      route.provider !== quote.route.provider ||
      route.environment !== quote.route.environment ||
      !route.orderAvailable
    ) {
      throw new FiatError(
        'PROVIDER_CAPABILITY_UNAVAILABLE',
        'This route supports quotes only. Transfers are not available yet.',
        503,
      );
    }
    const simulation = route.environment === 'simulation';
    // The vault is resolved here, never taken from the request: it is where a
    // deposit lands and where a failed payout is refunded.
    const vault = simulation ? '' : await this.store.vault(userId);
    if (!simulation && !vault)
      throw new FiatError(
        'ACCOUNT_NOT_READY',
        'Your Account is still being set up.',
        409,
      );
    const customerId = simulation
      ? null
      : ((await this.verification?.verifiedCustomerId(userId)) ?? null);
    if (!simulation) {
      const check = await this.limitCheck(
        userId,
        route.direction,
        quote,
        customerId,
      );
      if (check.verificationRequired)
        throw new FiatError(
          'VERIFICATION_REQUIRED',
          'Verify your identity to move more than this amount.',
          403,
        );
    }
    const allowed = new Set(quote.fields.map((f) => f.key));
    if (Object.keys(input.fields).some((k) => !allowed.has(k)))
      throw new FiatError('INVALID_FIELDS', 'Unexpected transfer details.');
    for (const field of quote.fields) {
      const value = input.fields[field.key];
      if (field.required && !value?.trim())
        throw new FiatError('INVALID_FIELDS', `${field.label} is required.`);
      if (
        value &&
        field.options &&
        !field.options.some((o) => o.value === value)
      )
        throw new FiatError('INVALID_FIELDS', `Choose a valid ${field.label}.`);
    }
    const now = new Date().toISOString();
    if (Date.parse(quote.expiresAt) <= Date.now()) {
      throw new FiatError(
        'QUOTE_EXPIRED',
        'Get a new quote before continuing.',
        410,
      );
    }
    const row: StoredFiatOrder = {
      userId,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      providerReference: null,
      order: {
        id: createId(),
        route: quote.route,
        quote,
        simulation,
        status: 'creating',
        instructions: simulation
          ? {
              kind: 'simulation',
              message: 'Preparing a test order. No real money moves.',
            }
          : { kind: 'bank_transfer', message: 'Preparing your transfer.' },
        createdAt: now,
        updatedAt: now,
      },
    };
    if (!(await this.store.create(row))) {
      const existing = await this.store.byKey(userId, input.idempotencyKey);
      if (existing?.requestHash === requestHash) return existing.order;
      throw new FiatError(
        'ORDER_CONFLICT',
        'This quote or request key already has an order.',
        409,
      );
    }
    try {
      const providerOrder = await this.registry
        .provider(route.provider)
        .createOrder({
          idempotencyKey: row.order.id,
          route: quote.route,
          quote,
          fields: input.fields,
          destinationAddress: vault ?? '',
          ...(customerId ? { customerId } : {}),
          ...(this.webhookUrl(route.provider, row.order.id)
            ? { webhookUrl: this.webhookUrl(route.provider, row.order.id) }
            : {}),
        });
      row.providerReference = providerOrder.reference;
      row.order = {
        ...row.order,
        status: providerOrder.status,
        instructions: providerOrder.instructions,
        updatedAt: new Date().toISOString(),
      };
      await this.store.save(row);
      this.report(userId, row.order, null);
      return this.order(userId, row.order.id);
    } catch (error) {
      // A refusal means no provider order exists, so nothing needs review and
      // the Consumer can correct the request and try again.
      const refused =
        error instanceof FiatError &&
        error.getStatus() >= 400 &&
        error.getStatus() < 500;
      row.order = {
        ...row.order,
        status: refused ? 'failed' : 'needs_attention',
        updatedAt: new Date().toISOString(),
      };
      await this.store.save(row);
      if (refused) {
        this.report(userId, row.order, null);
        throw error;
      }
      this.logger.error(
        `fiat.create uncertain order=${row.order.id} ${error instanceof Error ? error.message : ''}`,
      );
      throw new FiatError(
        'RECONCILIATION_REQUIRED',
        'The order needs review. Do not create a replacement transfer.',
        503,
      );
    }
  }
  /**
   * PAJ signs nothing we can verify yet, so each deposit order gets its own
   * callback URL carrying a token only that order's URL has. The token is
   * derived from the order id, so nothing extra is stored or sent to the app.
   */
  private webhookUrl(provider: string, orderId: string): string | undefined {
    const base = this.config?.get<string>('FIAT_WEBHOOK_BASE_URL');
    const token = this.hookToken(orderId);
    if (provider !== 'paj' || !base || !token) return undefined;
    return `${base.replace(/\/$/, '')}/webhooks/fiat/paj/orders/${encodeURIComponent(orderId)}/${token}`;
  }

  private hookToken(orderId: string): string | null {
    const secret =
      this.config?.get<string>('FIAT_WEBHOOK_TOKEN_SECRET') ||
      this.config?.get<string>('JWT_SECRET');
    if (!secret) return null;
    return createHmac('sha256', secret)
      .update(`paj-order:${orderId}`)
      .digest('hex')
      .slice(0, 40);
  }

  /**
   * A PAJ callback for one order. A wrong token is refused; a right one only
   * prompts a fresh read of the order from PAJ, never trusts the body.
   */
  async refreshFromOrderHook(
    orderId: string,
    token: string,
  ): Promise<'rejected' | FiatOrder | null> {
    const expected = this.hookToken(orderId);
    if (!expected) return 'rejected';
    const a = Buffer.from(expected, 'utf-8');
    const b = Buffer.from(token, 'utf-8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return 'rejected';
    const row = await this.store.byId(orderId);
    if (!row?.providerReference || row.order.route.provider !== 'paj')
      return null;
    return this.applyProvider(row);
  }

  async simulate(userId: string, id: string, input: FiatSimulationRequestBody) {
    const current = await this.order(userId, id);
    const provider = this.registry.provider(current.route.provider);
    if (
      !current.simulation ||
      current.route.environment !== 'simulation' ||
      !provider
    )
      throw new FiatError(
        'SIMULATION_DISABLED',
        'This order cannot be simulated.',
        403,
      );
    return this.store.event(
      userId,
      id,
      input.idempotencyKey,
      hash(input.event),
      (order) => ({
        ...order,
        status: nextFiatStatus(order.status, input.event),
        updatedAt: new Date().toISOString(),
      }),
    );
  }
}

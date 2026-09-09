import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createId } from '@paralleldrive/cuid2';
import { FiatProviderRegistry } from './fiat-provider.registry';
import { FIAT_STORE } from './fiat.repository';
import type { FiatStore } from './fiat.repository';
import type {
  FiatOrderRequestBody,
  FiatQuoteRequestBody,
  FiatSimulationRequestBody,
} from './dtos';
import type { FiatQuote, StoredFiatOrder } from './fiat.types';
import { FiatError } from './fiat.errors';
import { nextFiatStatus } from './fiat-state';

function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
@Injectable()
export class FiatService {
  constructor(
    private readonly registry: FiatProviderRegistry,
    @Inject(FIAT_STORE) private readonly store: FiatStore,
  ) {}
  async routes() {
    return { routes: await this.registry.routes() };
  }
  async quote(userId: string, input: FiatQuoteRequestBody): Promise<FiatQuote> {
    const route = await this.registry.route(input.routeId);
    if (!route.quoteAvailable)
      throw new FiatError('ROUTE_UNAVAILABLE', 'Quotes are unavailable.', 503);
    const quote = await this.registry
      .provider(route.provider)
      .quote(route, input.amountMinor);
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
      quote.debit.amountMinor !== input.amountMinor ||
      !/^[1-9]\d*$/.test(quote.credit.amountMinor)
    ) {
      throw new FiatError(
        'INVALID_PROVIDER_QUOTE',
        'The provider returned an unusable quote.',
        502,
      );
    }
    const result = { ...quote, id: createId(), route };
    await this.store.saveQuote(userId, result);
    return result;
  }
  async list(userId: string) {
    const orders = await this.store.list(userId);
    return {
      orders: await Promise.all(
        orders.map((order) => this.order(userId, order.id)),
      ),
    };
  }
  async order(userId: string, id: string) {
    const row = await this.store.order(userId, id);
    if (!row) throw new FiatError('ORDER_NOT_FOUND', 'Order not found.', 404);
    const order = row.order;
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
      return this.store.event(
        userId,
        id,
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
    // Only simulated execution is released in this slice. A real adapter needs
    // confirmed chain/bank evidence and the existing signing ceremony first.
    if (route.environment !== 'simulation')
      throw new FiatError(
        'EXECUTION_NOT_ENABLED',
        'Transfer execution has not been enabled for this route.',
        503,
      );
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
        simulation: true,
        status: 'creating',
        instructions: {
          kind: 'simulation',
          message: 'Preparing a test order. No real money moves.',
        },
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
          destinationAddress: '', // Simulator never uses a real Account.
        });
      row.providerReference = providerOrder.reference;
      row.order = {
        ...row.order,
        status: providerOrder.status,
        instructions: providerOrder.instructions,
        updatedAt: new Date().toISOString(),
      };
      await this.store.save(row);
      return this.order(userId, row.order.id);
    } catch {
      row.order = {
        ...row.order,
        status: 'needs_attention',
        updatedAt: new Date().toISOString(),
      };
      await this.store.save(row);
      throw new FiatError(
        'RECONCILIATION_REQUIRED',
        'The order needs review. Do not create a replacement transfer.',
        503,
      );
    }
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

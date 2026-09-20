import { NotFoundException } from '@nestjs/common';
import type { DbService } from '../db/db.service';
import type { MerchantOwnerService } from './merchant-owner.service';
import { MerchantPortalPaymentsController } from './merchant-portal-payments.controller';

const merchant = { id: 'm1', ownerProviderId: 'owner-1' } as never;

/**
 * A fake Drizzle client whose select() returns a thenable chain resolving to
 * the next queued result. Each element of `queue` is the rows one select
 * resolves to, in call order.
 */
function makeDb(queue: unknown[][]) {
  const calls = [...queue];
  const client = {
    select: () => {
      const rows = calls.shift() ?? [];
      const chain: Record<string, unknown> = {};
      for (const method of ['from', 'where', 'orderBy', 'limit']) {
        chain[method] = () => chain;
      }
      chain.then = (resolve: (v: unknown) => unknown) => resolve(rows);
      return chain;
    },
  };
  return { client } as unknown as DbService;
}

function controllerWith(db: DbService) {
  const owner = {
    owned: jest.fn().mockResolvedValue(merchant),
  } as unknown as MerchantOwnerService;
  return new MerchantPortalPaymentsController(db, owner);
}

describe('MerchantPortalPaymentsController', () => {
  it('returns a page and a nextCursor when more rows remain', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `pi_${i}`,
      status: 'succeeded',
      usdcSettlementRaw: '1000000',
      displayCurrency: 'USD',
      displayAmountMinor: '100',
      merchantReference: null,
      mode: 'test',
      createdAt: new Date(`2026-01-0${i + 1}`),
    }));
    const controller = controllerWith(makeDb([rows]));
    const result = await controller.list(
      'Bearer t',
      undefined,
      undefined,
      undefined,
      '2',
    );
    expect(result.payments).toHaveLength(2);
    expect(result.nextCursor).toBe('pi_1');
  });

  it('returns a null cursor on the final page', async () => {
    const rows = [
      {
        id: 'pi_0',
        status: 'created',
        usdcSettlementRaw: '1',
        displayCurrency: 'USD',
        displayAmountMinor: '1',
        merchantReference: 'order-1',
        mode: 'test',
        createdAt: new Date('2026-01-01'),
      },
    ];
    const controller = controllerWith(makeDb([rows]));
    const result = await controller.list(
      'Bearer t',
      undefined,
      undefined,
      undefined,
      '20',
    );
    expect(result.payments).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  it('assembles detail with confirmation reference and webhook delivery status', async () => {
    const intent = [
      {
        id: 'pi_1',
        merchantId: 'm1',
        status: 'succeeded',
        mode: 'live',
        usdcSettlementRaw: '2000000',
        displayCurrency: 'USD',
        displayAmountMinor: '200',
        pricingCurrency: 'USD',
        fxRate: null,
        fxSource: null,
        fxQuotedAt: null,
        merchantReference: 'order-9',
        metadata: { sku: 'x' },
        createdAt: new Date('2026-01-01'),
        expiresAt: new Date('2026-01-01'),
        authorizedAt: new Date('2026-01-01'),
      },
    ];
    const attempt = [{ txSignature: 'sig-attempt', failureReason: null }];
    const payment = [
      { txSignature: 'sig-final', settledAt: new Date('2026-01-02') },
    ];
    const deliveries = [
      {
        id: 'wd1',
        eventType: 'payment.succeeded',
        status: 'succeeded',
        attemptNo: 1,
        responseStatus: 200,
        createdAt: new Date('2026-01-02'),
      },
    ];
    const controller = controllerWith(
      makeDb([intent, attempt, payment, deliveries]),
    );
    const result = await controller.detail('Bearer t', 'pi_1');
    expect(result.confirmationReference).toBe('sig-final');
    expect(result.webhookDeliveries).toHaveLength(1);
    expect(result.settledAt).toBe('2026-01-02T00:00:00.000Z');
    expect(result.metadata).toEqual({ sku: 'x' });
  });

  it('maps a foreign or missing payment to 404', async () => {
    const controller = controllerWith(makeDb([[]]));
    await expect(controller.detail('Bearer t', 'pi_missing')).rejects.toThrow(
      NotFoundException,
    );
  });
});

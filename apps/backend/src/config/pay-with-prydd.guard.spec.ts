import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { CheckoutController } from '../checkout/checkout.controller';
import { InternalGuard } from '../merchant/internal.guard';
import { MerchantController } from '../merchant/merchant.controller';
import { RefundController } from '../merchant/refund.controller';
import { RefundService } from '../merchant/refund.service';
import { PendingPaymentController } from '../payment/pending-payment.controller';
import { PayWithPryddEnabledGuard } from './pay-with-prydd.guard';

const SECRET = 'internal-secret';

async function refundApp(payEnabled: string | undefined) {
  const refund = jest.fn().mockResolvedValue({ id: 'rf_1' });
  const moduleRef = await Test.createTestingModule({
    controllers: [RefundController],
    providers: [
      InternalGuard,
      PayWithPryddEnabledGuard,
      { provide: RefundService, useValue: { refund } },
      {
        provide: ConfigService,
        useValue: new ConfigService({
          INTERNAL_API_SECRET: SECRET,
          ...(payEnabled === undefined
            ? {}
            : { PAY_WITH_PRYDD_ENABLED: payEnabled }),
        }),
      },
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, refund };
}

function postRefund(app: INestApplication) {
  return request(app.getHttpServer() as Parameters<typeof request>[0])
    .post('/internal/refunds')
    .set('x-internal-api-key', SECRET)
    .set('idempotency-key', 'idem-1')
    .send({ payment_id: 'pay_1', amount_usdc_raw: '1000000' });
}

describe('PayWithPryddEnabledGuard', () => {
  it('refuses a Pay route while the flag is unset, before the service runs', async () => {
    const { app, refund } = await refundApp(undefined);

    const res = await postRefund(app);

    expect(res.status).toBe(404);
    expect((res.body as { code?: string }).code).toBe(
      'PAY_WITH_PRYDD_DISABLED',
    );
    expect(refund).not.toHaveBeenCalled();
    await app.close();
  });

  it('lets the same route through with the flag on', async () => {
    const { app, refund } = await refundApp('true');

    const res = await postRefund(app);

    expect(res.status).toBe(201);
    expect(refund).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('guards every route that creates or moves a Payment', () => {
    const guarded = (target: object) =>
      (Reflect.getMetadata(GUARDS_METADATA, target) ?? []) as unknown[];
    const proto = PendingPaymentController.prototype as unknown as Record<
      string,
      object
    >;

    for (const controller of [
      CheckoutController,
      MerchantController,
      RefundController,
    ]) {
      expect(guarded(controller)).toContain(PayWithPryddEnabledGuard);
    }
    expect(guarded(proto.prepare)).toContain(PayWithPryddEnabledGuard);
    expect(guarded(proto.submit)).toContain(PayWithPryddEnabledGuard);
    // Reading the list stays open: the wallet asks for it, and with creation
    // refused it is simply empty.
    expect(guarded(proto.list)).not.toContain(PayWithPryddEnabledGuard);
  });
});

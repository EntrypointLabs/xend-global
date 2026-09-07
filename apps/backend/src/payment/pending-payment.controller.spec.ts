import { HttpException } from '@nestjs/common';
import type { Request } from 'express';
import type { DbService } from '../db/db.service';
import type { PaymentAuthorizationService } from '../capability/payment-authorization.service';
import type { SettlementService } from '../settlement/settlement.service';
import { CapacityExceededError } from '../capability/capability.errors';
import { PendingPaymentController } from './pending-payment.controller';
import type { PaymentIntentService } from './payment-intent.service';

const OWNER = 'u_1';

function makeReq(userId = OWNER): Request & {
  user: { userId: string; walletAddress: string };
} {
  return {
    user: { userId, walletAddress: 'Wallet1' },
  } as Request & { user: { userId: string; walletAddress: string } };
}

function intentRow(over: Record<string, unknown> = {}) {
  return {
    id: 'pi_1',
    merchantId: 'm_1',
    consumerId: OWNER,
    status: 'created',
    displayCurrency: 'NGN',
    displayAmountMinor: '4500000',
    approvalDeferredAt: new Date('2026-08-29T10:00:00.000Z'),
    createdAt: new Date('2026-08-29T09:00:00.000Z'),
    expiresAt: new Date('2026-08-29T11:00:00.000Z'),
    ...over,
  };
}

function makeDb(displayName: string | null = 'Sabi Market'): DbService {
  const chain = {
    where: () => chain,
    limit: () => Promise.resolve(displayName ? [{ displayName }] : []),
  };
  return {
    client: { select: () => ({ from: () => chain }) },
  } as unknown as DbService;
}

function makeSettlement() {
  const buildSettlement = jest.fn().mockResolvedValue({
    unsignedTxBase64: 'UNSIGNED',
    messageBase64: 'PINNED',
    blockhash: 'Blockhash11',
    expectedSettlementAccount: 'Endpoint11',
    signerAddress: 'Signer1111',
    needsApprovalSignature: true,
  });
  const pinSettlement = jest.fn().mockResolvedValue({ attemptId: 'att_1' });
  const submitSettlement = jest
    .fn()
    .mockResolvedValue({ attemptId: 'att_1', signature: 'sig-1' });
  return {
    settlement: {
      buildSettlement,
      pinSettlement,
      submitSettlement,
    } as unknown as SettlementService,
    buildSettlement,
    pinSettlement,
    submitSettlement,
  };
}

function makeController(
  intentFakes: Partial<{
    findById: jest.Mock;
    listAwaitingApproval: jest.Mock;
  }>,
  authorize: jest.Mock = jest.fn().mockResolvedValue({ status: 'authorized' }),
) {
  const intents = {
    findById: jest.fn().mockResolvedValue(intentRow()),
    listAwaitingApproval: jest.fn().mockResolvedValue([]),
    ...intentFakes,
  };
  const settlementFakes = makeSettlement();
  const controller = new PendingPaymentController(
    intents as unknown as PaymentIntentService,
    { authorize } as unknown as PaymentAuthorizationService,
    settlementFakes.settlement,
    makeDb(),
  );
  return { controller, intents, authorize, ...settlementFakes };
}

async function expectRejectHttp(
  promise: Promise<unknown>,
  status: number,
  code: string,
) {
  try {
    await promise;
    throw new Error('expected rejection');
  } catch (err) {
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(status);
    expect((err as HttpException).getResponse()).toMatchObject({ code });
  }
}

describe('PendingPaymentController.list', () => {
  it('names the Merchant and the amount they charged', async () => {
    const { controller } = makeController({
      listAwaitingApproval: jest.fn().mockResolvedValue([intentRow()]),
    });

    const { payments } = await controller.list(makeReq());

    expect(payments).toEqual([
      {
        reference: 'pi_1',
        merchantDisplayName: 'Sabi Market',
        displayCurrency: 'NGN',
        displayAmountMinor: '4500000',
        deferredAt: '2026-08-29T10:00:00.000Z',
        expiresAt: '2026-08-29T11:00:00.000Z',
      },
    ]);
  });
});

describe('PendingPaymentController.prepare', () => {
  it('builds the Spend before authorizing, then pins it', async () => {
    const { controller, authorize, buildSettlement, pinSettlement } =
      makeController({});

    const out = await controller.prepare(makeReq(), 'pi_1');

    expect(out).toEqual({
      unsignedTxBase64: 'UNSIGNED',
      needsApprovalSignature: true,
    });
    // Order matters: a Payment the Account cannot carry has to be refused with
    // the intent untouched, not after capacity has been spent on it.
    expect(buildSettlement.mock.invocationCallOrder[0]).toBeLessThan(
      authorize.mock.invocationCallOrder[0],
    );
    expect(authorize.mock.invocationCallOrder[0]).toBeLessThan(
      pinSettlement.mock.invocationCallOrder[0],
    );
  });

  it('hides a Payment belonging to another Consumer', async () => {
    const { controller, buildSettlement } = makeController({
      findById: jest.fn().mockResolvedValue(intentRow({ consumerId: 'u_2' })),
    });

    await expectRejectHttp(
      controller.prepare(makeReq(), 'pi_1'),
      404,
      'INTENT_NOT_FOUND',
    );
    expect(buildSettlement).not.toHaveBeenCalled();
  });

  it('hides an intent Checkout never deferred', async () => {
    // Reaching a Payment the app was never handed would let this endpoint
    // authorize one the Consumer is mid-way through paying at the popup.
    const { controller } = makeController({
      findById: jest
        .fn()
        .mockResolvedValue(intentRow({ approvalDeferredAt: null })),
    });

    await expectRejectHttp(
      controller.prepare(makeReq(), 'pi_1'),
      404,
      'INTENT_NOT_FOUND',
    );
  });

  it('maps a capacity refusal to 409', async () => {
    const { controller } = makeController(
      {},
      jest.fn().mockRejectedValue(new CapacityExceededError('DAILY_CAP', 'no')),
    );

    await expectRejectHttp(
      controller.prepare(makeReq(), 'pi_1'),
      409,
      'CAPACITY_EXCEEDED',
    );
  });
});

describe('PendingPaymentController.submit', () => {
  it('hands the signed Spend to settlement and returns its signature', async () => {
    const { controller, submitSettlement } = makeController({});

    const out = await controller.submit(makeReq(), 'pi_1', {
      signedTxBase64: 'SIGNED',
    });

    expect(out).toEqual({ signature: 'sig-1' });
    expect(submitSettlement).toHaveBeenCalledWith('pi_1', 'SIGNED');
  });

  it('refuses to submit another Consumer’s Payment', async () => {
    const { controller, submitSettlement } = makeController({
      findById: jest.fn().mockResolvedValue(intentRow({ consumerId: 'u_2' })),
    });

    await expectRejectHttp(
      controller.submit(makeReq(), 'pi_1', { signedTxBase64: 'SIGNED' }),
      404,
      'INTENT_NOT_FOUND',
    );
    expect(submitSettlement).not.toHaveBeenCalled();
  });
});

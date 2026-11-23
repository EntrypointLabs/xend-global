import { ConfigService } from '@nestjs/config';
import {
  PajClient,
  PajRequestError,
} from '../../settlement/providers/paj/paj.client';
import { PajFiatProvider, pajStatus } from './paj-fiat.provider';
import { PaycrestClient } from './paycrest/paycrest.client';
import {
  PaycrestFiatProvider,
  paycrestStatus,
} from './paycrest/paycrest-fiat.provider';
import type { FiatRoute } from '../fiat-provider.interface';

const VAULT = '4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T';
const DEPOSIT = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';

const config = (values: Record<string, unknown>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

const errorCode = (code: string): unknown => {
  const response: unknown = expect.objectContaining({ code });
  return expect.objectContaining({ response });
};

describe('PAJ naira deposits', () => {
  const rates = {
    onRampRate: { rate: 1600, createdAt: '2026-11-20T10:00:00Z' },
    offRampRate: { rate: 1500, createdAt: '2026-11-20T10:00:00Z' },
  };
  let client: jest.Mocked<
    Pick<PajClient, 'getRates' | 'createOnramp' | 'getTransaction'>
  >;
  let provider: PajFiatProvider;
  let route: FiatRoute;

  beforeEach(async () => {
    client = {
      getRates: jest.fn().mockResolvedValue(rates),
      createOnramp: jest.fn(),
      getTransaction: jest.fn(),
    };
    provider = new PajFiatProvider(
      client as unknown as PajClient,
      config({ PAJ_API_KEY: 'key', FIAT_DEPOSIT_WINDOW_MINUTES: 30 }),
    );
    [route] = await provider.routes();
  });

  it('offers no route without a key', async () => {
    const off = new PajFiatProvider(client as unknown as PajClient, config({}));
    await expect(off.routes()).resolves.toEqual([]);
  });

  it('quotes whole naira into USDC at the on-ramp rate, rounding down', async () => {
    const quote = await provider.quote(route, '5000000');
    expect(quote.debit).toEqual({
      currency: 'NGN',
      amountMinor: '5000000',
      decimals: 2,
    });
    // ₦50,000 / 1600 = 31.25 USDC
    expect(quote.credit.amountMinor).toBe('31250000');
    await expect(provider.quote(route, '5000050')).rejects.toEqual(
      errorCode('INVALID_AMOUNT'),
    );
  });

  it('opens the deposit to the vault and shows the account for the app window only', async () => {
    client.createOnramp.mockResolvedValue({
      id: 'paj-1',
      status: 'INIT',
      fiatAmount: 50000,
      amount: 31.25,
      accountNumber: '9912345678',
      accountName: 'Paj Inc.(Pay NGN 50,000.00)',
      bank: 'Nombank MFB',
    });
    const quote = await provider.quote(route, '5000000');
    const before = Date.now();
    const order = await provider.createOrder({
      idempotencyKey: 'order-1',
      route,
      quote,
      fields: {},
      destinationAddress: VAULT,
      customerId: 'cus_1',
      webhookUrl: 'https://api.example/webhooks/fiat/paj',
    });
    expect(client.createOnramp).toHaveBeenCalledWith({
      fiatAmount: 50000,
      recipient: VAULT,
      customerId: 'cus_1',
      webhookURL: 'https://api.example/webhooks/fiat/paj',
    });
    expect(order.reference).toBe('paj-1');
    expect(order.instructions).toMatchObject({
      kind: 'bank_transfer',
      accountNumber: '9912345678',
      bankName: 'Nombank MFB',
      transferAmount: { currency: 'NGN', amountMinor: '5000000' },
    });
    const expires = Date.parse(order.instructions.expiresAt!);
    expect(expires - before).toBeGreaterThanOrEqual(30 * 60_000 - 50);
    expect(expires - before).toBeLessThanOrEqual(30 * 60_000 + 1000);
  });

  it('never shows incomplete bank details', async () => {
    client.createOnramp.mockResolvedValue({
      id: 'paj-2',
      status: 'INIT',
      fiatAmount: 50000,
      accountNumber: '',
      accountName: 'Paj Inc.',
      bank: 'Nombank',
    });
    const quote = await provider.quote(route, '5000000');
    await expect(
      provider.createOrder({
        idempotencyKey: 'order-2',
        route,
        quote,
        fields: {},
        destinationAddress: VAULT,
      }),
    ).rejects.toEqual(errorCode('PROVIDER_RESPONSE_INVALID'));
  });

  it('turns a PAJ refusal into a clean error and leaves timeouts uncertain', async () => {
    const quote = await provider.quote(route, '5000000');
    const create = () =>
      provider.createOrder({
        idempotencyKey: 'o',
        route,
        quote,
        fields: {},
        destinationAddress: VAULT,
      });
    client.createOnramp.mockRejectedValueOnce(new PajRequestError(403, 'kyc'));
    await expect(create()).rejects.toEqual(errorCode('VERIFICATION_REQUIRED'));
    const timeout = new Error('aborted');
    client.createOnramp.mockRejectedValueOnce(timeout);
    await expect(create()).rejects.toBe(timeout);
  });

  it('maps PAJ order states, treating ERROR as needing attention', () => {
    const t = (status: string) =>
      pajStatus({ id: 'x', status } as Parameters<typeof pajStatus>[0]);
    expect(t('INIT')).toBe('awaiting_payment');
    expect(t('PROCESSING')).toBe('processing');
    expect(t('PAID')).toBe('processing');
    expect(t('COMPLETED')).toBe('completed');
    expect(t('ERROR')).toBe('needs_attention');
    expect(t('CANCELLED')).toBe('failed');
  });

  it('reports a deleted order as unknown rather than failed', async () => {
    client.getTransaction.mockResolvedValue(null);
    await expect(provider.getOrder('gone')).resolves.toBeNull();
  });
});

describe('Paycrest bank payouts', () => {
  let client: jest.Mocked<
    Pick<
      PaycrestClient,
      'configured' | 'sellRate' | 'verifyAccount' | 'createOrder' | 'getOrder'
    >
  >;
  let provider: PaycrestFiatProvider;
  let route: FiatRoute;

  beforeEach(async () => {
    client = {
      configured: jest.fn().mockReturnValue(true),
      sellRate: jest
        .fn()
        .mockResolvedValue({ rate: '1500', providerIds: ['p1'] }),
      verifyAccount: jest
        .fn()
        .mockResolvedValue({ found: true, accountName: 'ADA OBI' }),
      createOrder: jest.fn(),
      getOrder: jest.fn(),
    };
    provider = new PaycrestFiatProvider(client as unknown as PaycrestClient);
    [route] = await provider.routes();
  });

  it('prices an exact naira payout with the least USDC that covers it', async () => {
    const quote = await provider.quote(route, '4500000', 'credit');
    expect(quote.credit.amountMinor).toBe('4500000');
    // ₦45,000 / 1500 = 30 USDC exactly
    expect(quote.debit.amountMinor).toBe('30000000');
    expect(quote.fields.map((f) => f.key)).toEqual([
      'bankCode',
      'accountNumber',
      'narration',
    ]);
    expect(quote.paymentStep).toBe('account_transfer');
  });

  it('rounds the USDC up so the recipient is never short', async () => {
    client.sellRate.mockResolvedValue({ rate: '1499.99', providerIds: [] });
    const quote = await provider.quote(route, '100000', 'credit');
    const usdc = BigInt(quote.debit.amountMinor);
    // kobo = usdcMinor * 149999 / 1e6; it must reach ₦1,000.00, and one less must not
    expect((usdc * 149999n) / 1_000_000n).toBeGreaterThanOrEqual(100000n);
    expect(((usdc - 1n) * 149999n) / 1_000_000n).toBeLessThan(100000n);
  });

  it('refuses payouts under ₦1,000', async () => {
    await expect(provider.quote(route, '99900', 'credit')).rejects.toEqual(
      errorCode('AMOUNT_OUT_OF_RANGE'),
    );
  });

  it('opens the order with the resolved name and returns the exact deposit', async () => {
    client.createOrder.mockResolvedValue({
      id: 'pc-1',
      status: 'initiated',
      providerAccount: {
        network: 'solana',
        receiveAddress: DEPOSIT,
        amountToTransfer: '30.1',
        validUntil: '2026-11-20T11:00:00Z',
      },
    });
    const quote = await provider.quote(route, '4500000', 'credit');
    const order = await provider.createOrder({
      idempotencyKey: 'order-9',
      route,
      quote,
      fields: {
        bankCode: 'GTBINGLA',
        accountNumber: '0123456789',
        narration: 'Rent for May',
      },
      destinationAddress: VAULT,
    });
    expect(client.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        memo: 'Rent for May',
        usdc: '30',
        rate: '1500',
        reference: 'order-9',
        refundAddress: VAULT,
        institution: 'GTBINGLA',
        accountName: 'ADA OBI',
      }),
    );
    expect(order.instructions).toMatchObject({
      kind: 'crypto_transfer',
      depositAddress: DEPOSIT,
      depositAmount: { currency: 'USDC', amountMinor: '30100000' },
      payoutAccountName: 'ADA OBI',
    });
  });

  it('refuses a deposit whose fee exceeds five percent and the flat floor', async () => {
    client.createOrder.mockResolvedValue({
      id: 'pc-2',
      status: 'initiated',
      providerAccount: {
        network: 'solana',
        receiveAddress: DEPOSIT,
        amountToTransfer: '40',
        validUntil: '2026-11-20T11:00:00Z',
      },
    });
    const quote = await provider.quote(route, '4500000', 'credit');
    await expect(
      provider.createOrder({
        idempotencyKey: 'order-10',
        route,
        quote,
        fields: { bankCode: 'GTBINGLA', accountNumber: '0123456789' },
        destinationAddress: VAULT,
      }),
    ).rejects.toEqual(errorCode('PROVIDER_RESPONSE_INVALID'));
  });

  it('stops before ordering when the account does not exist', async () => {
    client.verifyAccount.mockResolvedValue({ found: false });
    const quote = await provider.quote(route, '4500000', 'credit');
    await expect(
      provider.createOrder({
        idempotencyKey: 'order-11',
        route,
        quote,
        fields: { bankCode: 'GTBINGLA', accountNumber: '0123456789' },
        destinationAddress: VAULT,
      }),
    ).rejects.toEqual(errorCode('ACCOUNT_NOT_FOUND'));
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it('treats validated as paid and leaves unknown states alone', () => {
    expect(paycrestStatus('initiated')).toBe('awaiting_payment');
    expect(paycrestStatus('deposited')).toBe('processing');
    expect(paycrestStatus('validated')).toBe('completed');
    expect(paycrestStatus('refunded')).toBe('returned');
    expect(paycrestStatus('expired')).toBe('expired');
    expect(paycrestStatus('compliance_hold')).toBeNull();
  });

  it('reads an expired order with money sent back as returned, with the refund transfer', async () => {
    client.getOrder.mockResolvedValue({
      id: 'pc-1',
      status: 'expired',
      amountReturned: '1.187458',
      transactionLogs: [
        { status: 'order_initiated', tx_hash: '' },
        { status: 'order_refunded', tx_hash: 'RefundSig111' },
      ],
    });
    await expect(provider.getOrder('pc-1')).resolves.toEqual({
      reference: 'pc-1',
      status: 'returned',
      refundSignature: 'RefundSig111',
    });
  });

  it('keeps an expired order with nothing returned as expired', async () => {
    client.getOrder.mockResolvedValue({
      id: 'pc-2',
      status: 'expired',
      amountReturned: '0',
      transactionLogs: [{ status: 'order_initiated', tx_hash: '' }],
    });
    await expect(provider.getOrder('pc-2')).resolves.toEqual({
      reference: 'pc-2',
      status: 'expired',
    });
  });
});

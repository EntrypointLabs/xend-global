import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import {
  FONBNK_DEVNET_USDC,
  FonbnkSandboxOrders,
  type FonbnkOrderBinding,
} from './fonbnk-sandbox-orders';
const vault = '11111111111111111111111111111111';
const fundingAddress = 'So11111111111111111111111111111111111111112';
const id = '69281d944a1db009177f0198';
function binding(
  direction: 'receive' | 'send' = 'receive',
): FonbnkOrderBinding {
  return {
    orderParams: 'xend_test_order_123',
    direction,
    customer: {
      email: 'unit-test@example.com',
      countryIsoCode: 'NG',
      ip: '127.0.0.1',
    },
    vaultAddress: vault,
    fields: {
      phoneNumber: '2348012345678',
      bankCode: '1',
      bankAccountNumber: '1234567890',
    },
    quote: {
      reference: 'accepted_quote',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      debit:
        direction === 'receive'
          ? { currency: 'NGN', decimals: 2, amountMinor: '1000000' }
          : { currency: 'USDC', decimals: 6, amountMinor: '10000000' },
      credit:
        direction === 'receive'
          ? { currency: 'USDC', decimals: 6, amountMinor: '6000000' }
          : { currency: 'NGN', decimals: 2, amountMinor: '1500000' },
      fees: [],
      paymentStep: 'manual_transfer',
      fields: [
        {
          key: 'bankCode',
          label: 'Bank',
          type: 'select',
          required: true,
          options: [{ value: '1', label: 'Sandbox' }],
        },
      ],
    },
  };
}
function order(b: FonbnkOrderBinding, status = 'deposit_awaiting') {
  const bank = {
    paymentChannel: 'bank',
    currencyType: 'fiat',
    currencyCode: 'NGN',
    currencyDetails: { countryIsoCode: 'NG' },
    providedFieldsToCreateOrder: b.fields,
  };
  const crypto = {
    paymentChannel: 'crypto',
    currencyType: 'crypto',
    currencyCode: 'SOLANA_USDC',
    currencyDetails: {
      network: 'SOLANA',
      asset: 'USDC',
      contractAddress: FONBNK_DEVNET_USDC,
    },
    providedFieldsToCreateOrder: { blockchainWalletAddress: vault },
  };
  const amount = b.direction === 'receive' ? 10000 : 10;
  return {
    _id: id,
    userEmail: b.customer.email,
    countryIsoCode: 'NG',
    merchantOrderParams: b.orderParams,
    status,
    deposit: {
      ...(b.direction === 'receive' ? bank : crypto),
      cashout: { amountBeforeFees: amount, amountAfterFees: amount },
      transferInstructions: {
        type: 'manual',
        instructionsText: 'Sandbox transfer',
        transferDetails: [
          { id: 'amountToSend', label: 'Amount', value: String(amount) },
          ...(b.direction === 'send'
            ? [
                {
                  id: 'recipientWalletAddress',
                  label: 'Wallet',
                  value: fundingAddress,
                },
              ]
            : []),
        ],
        fieldsToConfirmOrder:
          b.direction === 'send'
            ? [
                {
                  key: 'blockchainTransactionHash',
                  type: 'string',
                  label: 'Transaction',
                  required: true,
                },
              ]
            : [],
      },
    },
    payout: {
      ...(b.direction === 'receive' ? crypto : bank),
      cashout: {
        amountBeforeFees: b.direction === 'receive' ? 6 : 15000,
        amountAfterFees: b.direction === 'receive' ? 6 : 15000,
      },
    },
    createdAt: '2026-09-09T20:00:00.000Z',
    updatedAt: '2026-09-09T20:00:00.000Z',
    expiresAt: '2026-09-09T20:05:00.000Z',
  };
}
function config(extra = {}) {
  return new ConfigService({
    NODE_ENV: 'test',
    FONBNK_ENV: 'sandbox',
    FONBNK_CLIENT_ID: 'unit-client',
    FONBNK_CLIENT_SECRET: 'dGVzdA==',
    ...extra,
  });
}
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status });
}

describe('Fonbnk sandbox order lifecycle contracts', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });
  afterEach(() => jest.restoreAllMocks());
  it.each(['receive', 'send'] as const)(
    'creates %s using locked quote and exact binding',
    async (direction) => {
      const b = binding(direction);
      fetchMock.mockResolvedValue(
        response({ quoteUsed: true, order: order(b) }),
      );
      const actual = await new FonbnkSandboxOrders(config()).create(b);
      expect(actual.evidence).toBe('provider_sandbox');
      expect(actual.deposit.amountMinor).toBe(b.quote.debit.amountMinor);
      expect(actual.payout.amountMinor).toBe(b.quote.credit.amountMinor);
      expect(actual.terminal).toBe(false);
      if (direction === 'send')
        expect(actual.funding).toEqual({
          network: 'solana-devnet',
          mint: FONBNK_DEVNET_USDC,
          address: fundingAddress,
          amountMinor: '10000000',
        });
      const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://sandbox-api.fonbnk.com/api/v2/order');
      const body = JSON.parse(request.body as string) as Record<
        string,
        unknown
      >;
      expect(body).toMatchObject({
        quoteId: b.quote.reference,
        orderParams: b.orderParams,
        userEmail: b.customer.email,
        userIp: b.customer.ip,
      });
      expect(body.payout).not.toHaveProperty('amount');
      const headers = request.headers as Record<string, string>;
      expect(headers['x-signature']).toBe(
        createHmac('sha256', Buffer.from('dGVzdA==', 'base64'))
          .update(`${headers['x-timestamp']}:/api/v2/order`)
          .digest('base64'),
      );
    },
  );
  it('rejects silent repricing and does not resubmit', async () => {
    const b = binding();
    fetchMock.mockResolvedValue(
      response({ quoteUsed: false, order: order(b) }),
    );
    await expect(new FonbnkSandboxOrders(config()).create(b)).rejects.toThrow(
      'accepted quote',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('reconciles by persisted reference after create timeout without automatically recreating', async () => {
    const b = binding();
    fetchMock
      .mockRejectedValueOnce(new Error('transport details are secret'))
      .mockResolvedValueOnce(response(order(b)));
    const client = new FonbnkSandboxOrders(config());
    await expect(client.create(b)).rejects.toThrow('outcome is unknown');
    expect((await client.findByReference(b))?.reference).toBe(id);
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://sandbox-api.fonbnk.com/api/v2/order?orderParams=xend_test_order_123',
    );
    expect(fetchMock.mock.calls[1][1]?.method).toBe('GET');
  });
  it.each([
    'deposit_expired',
    'deposit_canceled',
    'deposit_invalid',
    'payout_failed',
    'refund_failed',
  ])('keeps %s reconcilable instead of releasing funds', async (status) => {
    const b = binding();
    fetchMock.mockResolvedValue(response(order(b, status)));
    expect((await new FonbnkSandboxOrders(config()).get(id, b)).terminal).toBe(
      false,
    );
  });
  it.each(['payout_successful', 'refund_successful'])(
    'only marks %s terminal',
    async (status) => {
      const b = binding();
      fetchMock.mockResolvedValue(response(order(b, status)));
      expect(
        (await new FonbnkSandboxOrders(config()).get(id, b)).terminal,
      ).toBe(true);
    },
  );
  it('confirms funded crypto and treats repeat confirmation as read', async () => {
    const b = binding('send');
    fetchMock
      .mockResolvedValueOnce(response(order(b)))
      .mockImplementation(() =>
        Promise.resolve(response(order(b, 'deposit_validating'))),
      );
    const client = new FonbnkSandboxOrders(config());
    const fields = { blockchainTransactionHash: '2'.repeat(88) };
    await client.confirm(id, b, fields);
    await client.confirm(id, b, fields);
    expect(
      fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST'),
    ).toHaveLength(1);
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({
      orderId: id,
      fieldsToConfirmOrder: fields,
    });
  });
  it('refuses crypto confirmation without a transaction signature', async () => {
    const b = binding('send');
    fetchMock.mockResolvedValue(response(order(b)));
    await expect(
      new FonbnkSandboxOrders(config()).confirm(id, b, {}),
    ).rejects.toThrow('required funding');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([
    'owner',
    'reference',
    'mint',
    'destination',
    'amount',
    'instructions',
    'id',
  ])('rejects a mismatched %s response', async (mismatch) => {
    const b = binding();
    const value = order(b);
    if (mismatch === 'owner') value.userEmail = 'someone-else@example.com';
    if (mismatch === 'reference') value.merchantOrderParams = 'another_order';
    if (mismatch === 'mint')
      value.payout.currencyDetails = {
        ...value.payout.currencyDetails,
        contractAddress: 'mainnet-mint',
      };
    if (mismatch === 'destination')
      value.payout.providedFieldsToCreateOrder = {
        blockchainWalletAddress: fundingAddress,
      };
    if (mismatch === 'amount') value.payout.cashout.amountAfterFees = 5;
    if (mismatch === 'instructions')
      value.deposit.transferInstructions.transferDetails[0].value = '9000';
    if (mismatch === 'id') value._id = '000000000000000000000001';
    fetchMock.mockResolvedValue(response(value));
    await expect(new FonbnkSandboxOrders(config()).get(id, b)).rejects.toThrow(
      'does not match',
    );
  });
  it('returns missing reference without manufacturing a failed order', async () => {
    fetchMock.mockResolvedValue(response({}, 404));
    expect(
      await new FonbnkSandboxOrders(config()).findByReference(binding()),
    ).toBeNull();
  });
  it('surfaces documented permission gate without leaking provider body', async () => {
    fetchMock.mockResolvedValue(
      response({ message: 'sensitive raw payload' }, 403),
    );
    await expect(
      new FonbnkSandboxOrders(config()).create(binding()),
    ).rejects.toThrow('create-users permission');
  });
  it.each([
    { NODE_ENV: 'production' },
    { FONBNK_ENV: 'production' },
    { FONBNK_CLIENT_SECRET: '' },
  ])('refuses unsafe environment %j', async (extra) => {
    await expect(
      new FonbnkSandboxOrders(config(extra)).create(binding()),
    ).rejects.toThrow('sandbox credentials');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('requires customer identity and vault and rejects expired quote before network', async () => {
    const client = new FonbnkSandboxOrders(config());
    const b = binding();
    b.quote.expiresAt = '2020-01-01T00:00:00.000Z';
    await expect(client.create(b)).rejects.toThrow('Refresh');
    const missing = binding();
    delete missing.vaultAddress;
    await expect(client.create(missing)).rejects.toThrow('receiving vault');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

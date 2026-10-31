import { createHash } from 'node:crypto';
import { PagaProvider, type PagaTransport } from './paga.provider';
const config = {
  environment: 'sandbox' as const,
  publicKey: 'test-public',
  secretKey: 'test-secret',
  hashKey: 'test-hash',
};
const recipient = {
  bankCode: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  accountNumber: '0123456789',
  accountName: 'Test Consumer',
};
function setup(responder: (url: string, init: RequestInit) => unknown) {
  const transport = jest.fn<
    ReturnType<PagaTransport>,
    Parameters<PagaTransport>
  >((url, init) =>
    Promise.resolve(new Response(JSON.stringify(responder(url, init)))),
  );
  return { provider: new PagaProvider(config, transport), transport };
}
function body(init: RequestInit): Record<string, unknown> {
  return JSON.parse(init.body as string) as Record<string, unknown>;
}
const payout = {
  reference: 'order-1',
  amountMinor: '10001',
  recipient,
  narration: 'Send',
};
describe('Paga sandbox contract (mocked HTTP, not live settlement)', () => {
  it('creates held NGN account with exact Collect authentication and no auto-sweep', async () => {
    const { provider, transport } = setup((_url, init) => ({
      statusCode: '0',
      referenceNumber: body(init).referenceNumber,
      accountReference: 'consumer-001',
      accountNumber: '0123456789',
      status: 'ACTIVE',
      balance: 0,
      currency: 'NGN',
    }));
    expect(
      await provider.createAccount({
        reference: 'create-1',
        accountReference: 'consumer-001',
        firstName: 'Test',
        lastName: 'Consumer',
        email: 'test@example.com',
      }),
    ).toMatchObject({ currency: 'NGN', custody: 'pooled' });
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe('https://beta-collect.paga.com/subsidiary-accounts');
    expect(init.redirect).toBe('error');
    expect(init.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from('test-public:test-secret').toString('base64')}`,
      hash: createHash('sha512')
        .update('create-1consumer-001test-hash')
        .digest('hex'),
    });
    expect(body(init)).not.toHaveProperty('autoSweep');
  });
  it('rejects mismatched account creation identity', async () => {
    const { provider } = setup(() => ({
      statusCode: '0',
      referenceNumber: 'wrong',
    }));
    await expect(
      provider.createAccount({
        reference: 'create-1',
        accountReference: 'consumer-001',
        firstName: 'Test',
        lastName: 'Consumer',
        email: 'test@example.com',
      }),
    ).rejects.toThrow('invalid_response');
  });
  it.each(['short', 'x'.repeat(31)])(
    'rejects invalid subsidiary account reference length: %s',
    async (accountReference) => {
      const { provider, transport } = setup(() => ({}));
      await expect(
        provider.createAccount({
          reference: 'create-1',
          accountReference,
          firstName: 'Test',
          lastName: 'Consumer',
          email: 'test@example.com',
        }),
      ).rejects.toThrow();
      expect(transport).not.toHaveBeenCalled();
    },
  );
  it('reads exact balance with account identity and UTC timestamp', async () => {
    const { provider } = setup(() => ({
      statusCode: '0',
      referenceNumber: 'read-1',
      accountReference: 'consumer-001',
      currency: 'NGN',
      balance: '500000.01',
      timeStamp: '2026-09-09T10:00:00',
    }));
    expect(await provider.getBalance('consumer-001', 'read-1')).toEqual({
      amountMinor: '50000001',
      currency: 'NGN',
      observedAt: '2026-09-09T10:00:00Z',
    });
  });
  it('lists banks and resolves a name without transferring', async () => {
    const { provider, transport } = setup((url, init) => ({
      responseCode: 0,
      referenceNumber: body(init).referenceNumber,
      ...(url.endsWith('/getBanks')
        ? { bank: [{ uuid: recipient.bankCode, name: 'Bank' }] }
        : { destinationAccountHolderNameAtBank: recipient.accountName }),
    }));
    expect(await provider.banks()).toEqual([
      { code: recipient.bankCode, name: 'Bank' },
    ]);
    expect(
      await provider.resolveRecipient(
        recipient.bankCode,
        recipient.accountNumber,
      ),
    ).toEqual(recipient);
    expect(transport.mock.calls[1][0]).toContain('/validateDepositToBank');
  });
  it('submits one bank payout only with exact cents and deterministic hash', async () => {
    const { provider, transport } = setup(() => ({
      responseCode: 0,
      referenceNumber: 'order-1',
      transactionId: 'T1',
      currency: 'NGN',
      destinationAccountHolderNameAtBank: recipient.accountName,
    }));
    expect(await provider.submitPayout(payout)).toMatchObject({
      status: 'pending',
      evidence: 'fixture',
      amountMinor: '10001',
    });
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, init] = transport.mock.calls[0];
    expect(url).toContain('/depositToBank');
    expect(body(init).amount).toBe('100.01');
    expect(init.headers).toMatchObject({
      principal: 'test-public',
      credentials: 'test-secret',
      hash: createHash('sha512')
        .update(
          `order-1100.01${recipient.bankCode}${recipient.accountNumber}test-hash`,
        )
        .digest('hex'),
    });
  });
  it('does not call published status response verified when recipient fields are absent', async () => {
    const { provider } = setup(() => ({
      responseCode: 0,
      referenceNumber: 'order-1',
      transactionId: 'T1',
      currency: 'NGN',
      amount: 100.01,
      status: 'SUCCESSFUL',
    }));
    expect(
      await provider.getPayout({ ...payout, providerReference: 'T1' }),
    ).toMatchObject({ status: 'unknown', evidence: 'fixture' });
  });
  it('keeps a fully matched payout fixture-only and rejects changed amount', async () => {
    const { provider } = setup(() => ({
      responseCode: 0,
      referenceNumber: 'order-1',
      transactionId: 'T1',
      currency: 'NGN',
      amount: '100.01',
      status: 'SUCCESSFUL',
      destinationBankUUID: recipient.bankCode,
      destinationBankAccountNumber: recipient.accountNumber,
    }));
    expect(
      await provider.getPayout({ ...payout, providerReference: 'T1' }),
    ).toMatchObject({ status: 'succeeded', evidence: 'fixture' });
    await expect(
      provider.getPayout({
        ...payout,
        amountMinor: '10000',
        providerReference: 'T1',
      }),
    ).rejects.toThrow('invalid_response');
  });
  it('keeps charge and topup as separate legs and signs the exact numeric decimal', async () => {
    const { provider, transport } = setup((_url, init) => ({
      statusCode: '0',
      referenceNumber: body(init).referenceNumber,
      transactionId: 'T2',
      newBalance: 10,
    }));
    const input = {
      reference: 'charge-1',
      accountIdentifier: 'consumer-001',
      amountMinor: '101',
      narration: 'Fund payout',
    };
    expect(await provider.charge(input)).toMatchObject({ status: 'pending' });
    expect(transport.mock.calls[0][1].body as string).toContain(
      '"amount":1.01',
    );
    expect(transport.mock.calls[0][1].headers).toMatchObject({
      hash: createHash('sha512')
        .update('charge-11.01NGNFund payouttest-hash')
        .digest('hex'),
    });
    await provider.topup({ ...input, reference: 'refund-1' });
    expect(transport.mock.calls[1][0]).toContain('/topup');
  });
  it('retains unknown outcomes on timeout without exposing provider or credential details', async () => {
    const transport: PagaTransport = () =>
      Promise.reject(new Error('sensitive provider response'));
    const provider = new PagaProvider(config, transport);
    await expect(provider.submitPayout(payout)).rejects.toThrow(
      'unknown_outcome',
    );
  });
  it.each([401, 422, 500])('normalizes HTTP error %i', async (status) => {
    const provider = new PagaProvider(config, () =>
      Promise.resolve(new Response('private detail', { status })),
    );
    await expect(provider.submitPayout(payout)).rejects.toThrow(
      status === 401
        ? 'authentication'
        : status === 500
          ? 'unknown_outcome'
          : 'rejected',
    );
  });
  it('rejects malformed inputs before network I/O and refuses production', async () => {
    const { provider, transport } = setup(() => ({}));
    await expect(
      provider.submitPayout({ ...payout, amountMinor: '1.01' }),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
    expect(
      () =>
        new PagaProvider({ ...config, environment: 'production' as 'sandbox' }),
    ).toThrow('configuration');
  });
});

import { createHmac } from 'node:crypto';
import { NombaAdapter, verifyNombaWebhook } from './nomba.adapter';

const recipient = {
  bankCode: '058',
  accountNumber: '0000000000',
  accountName: 'Sandbox Recipient',
};
const payout = {
  reference: 'xend-test',
  amountMinor: '10001',
  recipient,
  narration: 'Test',
};
const record = {
  id: 'provider-1',
  amount: '100.01',
  type: 'transfer',
  status: 'SUCCESS',
  meta: { merchantTxRef: payout.reference, currency: 'NGN', ...recipient },
};
function setup(data: unknown = record) {
  const transport = jest.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ code: '00', data }), { status: 200 }),
    ),
  );
  return {
    transport,
    adapter: new NombaAdapter({ senderName: 'Xend' }, transport),
  };
}
describe('Nomba sandbox adapter', () => {
  it('rejects production URLs and partial authentication', () => {
    expect(
      () =>
        new NombaAdapter({
          senderName: 'Xend',
          baseUrl: 'https://api.nomba.com',
        }),
    ).toThrow('NOMBA_PRODUCTION_DISABLED');
    expect(
      () => new NombaAdapter({ senderName: 'Xend', accessToken: 'test' }),
    ).toThrow('NOMBA_INCOMPLETE_AUTH');
  });
  it('sends exact minor units and never claims verified settlement', async () => {
    const { adapter, transport } = setup();
    expect(await adapter.submitPayout(payout)).toMatchObject({
      amountMinor: '10001',
      status: 'succeeded',
      evidence: 'fixture',
    });
    const call = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(call[1].body as string)).toMatchObject({
      amount: 100.01,
      merchantTxRef: payout.reference,
    });
    expect(call[1].redirect).toBe('error');
  });
  it.each(['0', '-1', '1.2', '01', '9007199254740992'])(
    'rejects invalid or unsafe amount %s',
    async (amountMinor) => {
      const { adapter, transport } = setup();
      await expect(
        adapter.submitPayout({ ...payout, amountMinor }),
      ).rejects.toThrow('NOMBA_INVALID_AMOUNT');
      expect(transport).not.toHaveBeenCalled();
    },
  );
  it('does not retry an uncertain write', async () => {
    const { adapter, transport } = setup();
    transport.mockRejectedValueOnce(new Error('timeout'));
    await expect(adapter.submitPayout(payout)).rejects.toThrow(
      'NOMBA_SUBMISSION_UNCERTAIN',
    );
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('identifies an acceptance without transaction ID as uncertain', async () => {
    await expect(
      setup({ status: 'PENDING_BILLING' }).adapter.submitPayout(payout),
    ).rejects.toThrow('NOMBA_SUBMISSION_UNCERTAIN');
  });
  it.each([
    { ...record, amount: '100.02' },
    { ...record, type: 'withdrawal' },
    { ...record, meta: { ...record.meta, merchantTxRef: 'foreign' } },
    { ...record, meta: { ...record.meta, currency: 'USD' } },
    { ...record, meta: { ...record.meta, accountNumber: '1111111111' } },
    { ...record, meta: { ...record.meta, bankCode: undefined } },
  ])('rejects missing or mismatched transaction evidence', async (data) => {
    await expect(
      setup(data).adapter.getPayout({
        ...payout,
        providerReference: record.id,
      }),
    ).rejects.toThrow('NOMBA_TRANSACTION_MISMATCH');
  });
  it('rejects a changed ID even when merchant reference is equal', async () => {
    await expect(
      setup({ ...record, id: 'retry-created-another-id' }).adapter.getPayout({
        ...payout,
        providerReference: record.id,
      }),
    ).rejects.toThrow('NOMBA_TRANSACTION_MISMATCH');
  });
  it('keeps same-ref provider retries distinct, without claiming provider idempotency', async () => {
    const { adapter, transport } = setup();
    await adapter.submitPayout(payout);
    transport.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: '00', data: { ...record, id: 'provider-2' } }),
      ),
    );
    expect((await adapter.submitPayout(payout)).providerReference).toBe(
      'provider-2',
    );
    // Cross-request dedupe must live in the durable Xend orchestrator, never this HTTP adapter.
  });
  it.each([
    ['PENDING_BILLING', 'pending'],
    ['REFUND', 'refunded'],
    ['FAILED', 'failed'],
    ['NEW_STATUS', 'unknown'],
  ])('maps %s without guessing finality', async (status, expected) => {
    expect(
      (
        await setup({ ...record, status }).adapter.getPayout({
          ...payout,
          providerReference: record.id,
        })
      ).status,
    ).toBe(expected);
  });
  it('attaches server authentication while retaining fixture evidence', async () => {
    const { transport } = setup();
    const adapter = new NombaAdapter(
      {
        senderName: 'Xend',
        accessToken: 'test-token',
        accountId: 'test-account',
      },
      transport,
    );
    expect(
      (await adapter.getPayout({ ...payout, providerReference: record.id }))
        .evidence,
    ).toBe('fixture');
    const call = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[1].headers).toMatchObject({
      Authorization: 'Bearer test-token',
      accountId: 'test-account',
    });
    expect(call[0]).toContain('merchantTxRef=xend-test');
  });
  it('creates a static account with matching reference and pooled custody', async () => {
    const { adapter, transport } = setup({
      accountRef: 'consumer-ref',
      currency: 'NGN',
      bankAccountNumber: '0000000000',
      bankAccountName: 'Test Name',
      bankName: 'Test Bank',
    });
    const result = await adapter.createAccount({
      reference: 'idempotency-ref',
      accountReference: 'consumer-ref',
      firstName: 'Test',
      lastName: 'Name',
      email: 'test@example.com',
    });
    expect(result.custody).toBe('pooled');
    const call = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(call[1].body as string)).not.toHaveProperty('expiryDate');
  });
  it('rejects account reference mismatch', async () => {
    await expect(
      setup({ accountRef: 'wrong' }).adapter.createAccount({
        reference: 'request',
        accountReference: 'consumer',
        firstName: 'A',
        lastName: 'B',
        email: 'a@example.com',
      }),
    ).rejects.toThrow('NOMBA_ACCOUNT_MISMATCH');
  });
  it('lists banks and checks lookup identity', async () => {
    const banks = setup([{ code: '058', name: 'Test Bank' }]);
    expect(await banks.adapter.banks()).toEqual([
      { code: '058', name: 'Test Bank' },
    ]);
    expect(banks.transport).toHaveBeenCalledWith(
      'https://sandbox.nomba.com/v1/transfers/banks',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(
      await setup(recipient).adapter.resolveRecipient('058', '0000000000'),
    ).toEqual(recipient);
    await expect(
      setup({
        ...recipient,
        accountNumber: '1111111111',
      }).adapter.resolveRecipient('058', '0000000000'),
    ).rejects.toThrow('NOMBA_RECIPIENT_MISMATCH');
  });
});

describe('Nomba account recovery', () => {
  const account = {
    accountRef: 'xna-owned-account-reference',
    accountHolderId: 'sandbox-parent',
    currency: 'NGN',
    expired: false,
    bankAccountNumber: '0123456789',
    bankAccountName: 'Xend Sandbox',
    bankName: 'Nomba',
  };
  function authenticated(data: unknown) {
    const { transport } = setup(data);
    return {
      transport,
      adapter: new NombaAdapter(
        {
          senderName: 'Xend',
          accessToken: 'sandbox-token',
          accountId: 'sandbox-parent',
        },
        transport,
      ),
    };
  }
  it('recovers only the matching active account under the configured parent using a read', async () => {
    const { adapter, transport } = authenticated(account);
    await expect(
      adapter.retrieveAccount(account.accountRef, 'request'),
    ).resolves.toEqual({
      provider: 'nomba',
      reference: account.accountRef,
      accountNumber: account.bankAccountNumber,
      accountName: account.bankAccountName,
      bankName: account.bankName,
      currency: 'NGN',
      custody: 'pooled',
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith(
      `https://sandbox.nomba.com/v1/accounts/virtual/${account.accountRef}`,
      expect.objectContaining({
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer sandbox-token',
          accountId: 'sandbox-parent',
        },
      }),
    );
  });
  it.each([
    { accountRef: 'other-reference' },
    { accountHolderId: 'other-parent' },
    { accountHolderId: undefined },
    { currency: 'USD' },
    { expired: true },
    { expired: undefined },
    { bankAccountNumber: '123' },
  ])(
    'refuses mismatched or incomplete recovery evidence: %j',
    async (overrides) => {
      await expect(
        authenticated({ ...account, ...overrides }).adapter.retrieveAccount(
          account.accountRef,
          'request',
        ),
      ).rejects.toThrow('NOMBA_ACCOUNT_MISMATCH');
    },
  );
  it('does not recover an account from anonymous sandbox responses', async () => {
    const { adapter, transport } = setup(account);
    await expect(
      adapter.retrieveAccount(account.accountRef, 'request'),
    ).rejects.toThrow('NOMBA_AUTH_REQUIRED');
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([
    { accountHolderId: 'other-parent' },
    { accountHolderId: undefined },
    { expired: undefined },
  ])(
    'does not activate an authenticated create response with incomplete parent ownership: %j',
    async (overrides) => {
      await expect(
        authenticated({ ...account, ...overrides }).adapter.createAccount({
          reference: 'request',
          accountReference: account.accountRef,
          firstName: 'Xend',
          lastName: 'Sandbox',
          email: 'sandbox@example.com',
        }),
      ).rejects.toThrow('NOMBA_ACCOUNT_MISMATCH');
    },
  );
});

describe('Nomba webhook notification verification', () => {
  const timestamp = '2026-09-09T12:00:00Z';
  const payload = {
    event_type: 'payment_success',
    requestId: 'event',
    data: {
      merchant: { userId: 'merchant', walletId: 'wallet' },
      transaction: {
        transactionId: 'txn',
        type: 'vact_transfer',
        time: timestamp,
        responseCode: '',
        transactionAmount: 10,
      },
    },
  };
  const signature = createHmac('sha256', 'test-secret')
    .update(
      `payment_success:event:merchant:wallet:txn:vact_transfer:${timestamp}::${timestamp}`,
    )
    .digest('base64');
  const headers = {
    'nomba-signature': signature,
    'nomba-signature-algorithm': 'HmacSHA256',
    'nomba-signature-version': '1.0.0',
    'nomba-timestamp': timestamp,
  };
  it('validates signed fields but demonstrates unsigned amounts are not money authority', () => {
    expect(
      verifyNombaWebhook(
        payload,
        headers,
        'test-secret',
        Date.parse(timestamp),
      ),
    ).toBe(true);
    const changed = structuredClone(payload);
    changed.data.transaction.transactionAmount = 999999;
    expect(
      verifyNombaWebhook(
        changed,
        headers,
        'test-secret',
        Date.parse(timestamp),
      ),
    ).toBe(true);
  });
  it('rejects changed signed identity, case-corrupted signature, stale or malformed notifications', () => {
    expect(
      verifyNombaWebhook(
        { ...payload, requestId: 'tampered' },
        headers,
        'test-secret',
        Date.parse(timestamp),
      ),
    ).toBe(false);
    expect(
      verifyNombaWebhook(
        payload,
        { ...headers, 'nomba-signature': signature.toLowerCase() },
        'test-secret',
        Date.parse(timestamp),
      ),
    ).toBe(false);
    expect(
      verifyNombaWebhook(
        payload,
        headers,
        'test-secret',
        Date.parse(timestamp) + 300001,
      ),
    ).toBe(false);
    expect(
      verifyNombaWebhook({}, headers, 'test-secret', Date.parse(timestamp)),
    ).toBe(false);
  });
});

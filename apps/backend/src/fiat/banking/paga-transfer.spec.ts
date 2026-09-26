import { createHash } from 'node:crypto';
import { PagaProvider, type PagaTransport } from './paga.provider';

describe('Paga subsidiary transfer documented contract', () => {
  const input = {
    reference: 'transfer-1',
    sourceAccountIdentifier: '1234567890',
    destinationAccountIdentifier: '0987654321',
    amountMinor: '123456789012345',
    narration: 'Test transfer',
  };
  const response = () => ({
    referenceNumber: input.reference,
    statusCode: '0',
    transactionId: 'provider-id',
    source: {
      accountIdentifier: input.sourceAccountIdentifier,
      amount: '1234567890123.45',
      newBalance: '1.00',
    },
    destination: {
      accountIdentifier: input.destinationAccountIdentifier,
      amount: '1234567890123.45',
      newBalance: '1234567890123.45',
    },
  });
  const transport = jest.fn<
    ReturnType<PagaTransport>,
    Parameters<PagaTransport>
  >();
  const provider = new PagaProvider(
    {
      environment: 'sandbox',
      publicKey: 'public',
      secretKey: 'secret',
      hashKey: 'hash',
    },
    transport,
  );
  beforeEach(() => transport.mockReset());
  it('posts exact numeric amount and signed source/destination to documented sandbox endpoint', async () => {
    transport.mockResolvedValue(new Response(JSON.stringify(response())));
    expect(await provider.transferSubsidiary(input)).toEqual({
      providerReference: 'provider-id',
      sourceBalanceMinor: '100',
      destinationBalanceMinor: input.amountMinor,
      evidence: 'sandbox_response',
    });
    const [url, request] = transport.mock.calls[0];
    expect(url).toBe(
      'https://beta-collect.paga.com/subsidiary-accounts/transfer',
    );
    expect(request.body).toContain('"amount":1234567890123.45');
    expect(request.headers).toMatchObject({
      hash: createHash('sha512')
        .update(
          'transfer-1123456789009876543211234567890123.45NGNTest transferhash',
        )
        .digest('hex'),
    });
  });
  it.each([
    'reference',
    'source',
    'destination',
    'sourceAmount',
    'destinationAmount',
  ])('rejects mismatched %s without settlement', async (field) => {
    const data = response();
    if (field === 'reference') data.referenceNumber = 'other';
    if (field === 'source') data.source.accountIdentifier = '1111111111';
    if (field === 'destination')
      data.destination.accountIdentifier = '1111111111';
    if (field === 'sourceAmount') data.source.amount = '1';
    if (field === 'destinationAmount') data.destination.amount = '1';
    transport.mockResolvedValue(new Response(JSON.stringify(data)));
    await expect(provider.transferSubsidiary(input)).rejects.toThrow(
      'invalid_response',
    );
  });
  it('does not retry an ambiguous mutation and rejects self transfer before calling provider', async () => {
    transport.mockRejectedValue(new Error('timeout'));
    await expect(provider.transferSubsidiary(input)).rejects.toThrow(
      'unknown_outcome',
    );
    expect(transport).toHaveBeenCalledTimes(1);
    await expect(
      provider.transferSubsidiary({
        ...input,
        destinationAccountIdentifier: input.sourceAccountIdentifier,
      }),
    ).rejects.toThrow('invalid_input');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('verifies a retrieved recipient by account, reference, currency and state', async () => {
    transport.mockResolvedValue(
      new Response(
        JSON.stringify({
          statusCode: '0',
          referenceNumber: 'lookup-1',
          accountNumber: '0987654321',
          accountReference: 'recipient-ref',
          accountName: 'Recipient',
          balance: '12.34',
          currency: 'NGN',
          status: 'ACTIVE',
        }),
      ),
    );
    expect(await provider.retrieveAccount('0987654321', 'lookup-1')).toEqual({
      accountNumber: '0987654321',
      accountReference: 'recipient-ref',
      accountName: 'Recipient',
      balanceMinor: '1234',
    });
    transport.mockResolvedValue(
      new Response(
        JSON.stringify({
          statusCode: '0',
          referenceNumber: 'lookup-1',
          accountNumber: '1111111111',
          accountReference: 'wrong',
          accountName: 'Recipient',
          balance: '12.34',
          currency: 'NGN',
          status: 'ACTIVE',
        }),
      ),
    );
    await expect(
      provider.retrieveAccount('0987654321', 'lookup-1'),
    ).rejects.toThrow('invalid_response');
  });
});

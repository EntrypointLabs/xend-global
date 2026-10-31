import { NombaAdapter } from './nomba.adapter';

const transaction = {
  id: 'deposit/1',
  userId: 'merchant',
  type: 'vact_transfer',
  status: 'SUCCESS',
  amount: '100.00',
  fixedCharge: '10.00',
  timeCreated: '2026-09-14T12:51:20Z',
  source: 'api',
};
function setup(data: unknown = transaction, authenticated = true) {
  const transport = jest.fn<Promise<Response>, [string, RequestInit]>(() =>
    Promise.resolve(new Response(JSON.stringify({ code: '00', data }))),
  );
  return {
    transport,
    adapter: new NombaAdapter(
      {
        senderName: 'Xend',
        ...(authenticated
          ? { accessToken: 'test-token', accountId: 'merchant' }
          : {}),
      },
      transport,
    ),
  };
}
describe('Nomba notification transaction lookup', () => {
  it('uses authenticated GET with an encoded ID and exact minor units', async () => {
    const { adapter, transport } = setup();
    expect(await adapter.getTransaction('deposit/1')).toMatchObject({
      transactionId: 'deposit/1',
      merchantId: 'merchant',
      amountMinor: '10000',
      feeMinor: '1000',
      evidence: 'authenticated_sandbox',
    });
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe(
      'https://sandbox.nomba.com/v1/transactions/accounts/single?transactionRef=deposit%2F1',
    );
    expect(init.method).toBe('GET');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer test-token',
      accountId: 'merchant',
    });
  });
  it('does not call the public fixture API as authenticated evidence', async () => {
    const { adapter, transport } = setup(transaction, false);
    await expect(adapter.getTransaction('deposit/1')).rejects.toThrow(
      'NOMBA_AUTH_REQUIRED',
    );
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([
    { id: 'other' },
    { amount: '-1' },
    { amount: '100.001' },
    { fixedCharge: '-1' },
    { timeCreated: 'invalid' },
  ])('rejects malformed evidence %j', async (changes) => {
    await expect(
      setup({ ...transaction, ...changes }).adapter.getTransaction('deposit/1'),
    ).rejects.toThrow();
  });
  it('preserves missing merchant and fee as unknown', async () => {
    expect(
      await setup({
        ...transaction,
        userId: undefined,
        fixedCharge: undefined,
      }).adapter.getTransaction('deposit/1'),
    ).toMatchObject({ merchantId: null, feeMinor: null });
  });
});

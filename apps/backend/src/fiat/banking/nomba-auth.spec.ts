import { NombaSandboxAuth } from './nomba-auth';
import { NombaAdapter } from './nomba.adapter';

const credentials = {
  clientId: 'fixture-client',
  clientSecret: 'fixture-secret',
  accountId: 'fixture-account',
};
const start = Date.parse('2026-09-09T00:00:00Z');
function response(accessToken = 'first-token', at = start, overrides = {}) {
  return new Response(
    JSON.stringify({
      code: '00',
      data: {
        access_token: accessToken,
        refresh_token: `${accessToken}-refresh`,
        expiresAt: new Date(at + 1_800_000).toISOString(),
        ...overrides,
      },
    }),
  );
}

describe('Nomba sandbox server authentication', () => {
  it('issues once for concurrent requests, caches, and refreshes before expiry without resending the client secret', async () => {
    let now = start;
    const transport = jest
      .fn<Promise<Response>, [string, RequestInit]>()
      .mockResolvedValueOnce(response())
      .mockImplementationOnce(() =>
        Promise.resolve(response('second-token', now)),
      );
    const auth = new NombaSandboxAuth(credentials, transport, () => now);
    expect(
      await Promise.all([auth.getAccessToken(), auth.getAccessToken()]),
    ).toEqual(['first-token', 'first-token']);
    expect(await auth.getAccessToken()).toBe('first-token');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0]).toBe(
      'https://sandbox.nomba.com/v1/auth/token/issue',
    );
    expect(transport.mock.calls[0][1]).toMatchObject({
      redirect: 'error',
      headers: { accountId: credentials.accountId },
    });
    expect(JSON.parse(transport.mock.calls[0][1].body as string)).toEqual({
      grant_type: 'client_credentials',
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    });
    now += 1_500_000;
    expect(
      await Promise.all([auth.getAccessToken(), auth.getAccessToken()]),
    ).toEqual(['second-token', 'second-token']);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[1][0]).toBe(
      'https://sandbox.nomba.com/v1/auth/token/refresh',
    );
    expect(
      new Headers(transport.mock.calls[1][1].headers).get('Authorization'),
    ).toBe('Bearer first-token');
    expect(JSON.parse(transport.mock.calls[1][1].body as string)).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'first-token-refresh',
    });
    expect(transport.mock.calls[1][1].body).not.toContain(
      credentials.clientSecret,
    );
    auth.invalidate('first-token');
    expect(await auth.getAccessToken()).toBe('second-token');
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403, 429, 500])(
    'sanitizes auth rejection %s without returning the response body',
    async (status) => {
      const transport = jest
        .fn<Promise<Response>, [string, RequestInit]>()
        .mockResolvedValue(new Response(credentials.clientSecret, { status }));
      const auth = new NombaSandboxAuth(credentials, transport, () => start);
      await expect(auth.getAccessToken()).rejects.toThrow(
        status >= 429 ? 'NOMBA_AUTH_UNAVAILABLE' : 'NOMBA_AUTH_REJECTED',
      );
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );

  it('does not keep a rejected pending promise and sanitizes transport errors', async () => {
    const transport = jest
      .fn<Promise<Response>, [string, RequestInit]>()
      .mockRejectedValueOnce(new Error(credentials.clientSecret))
      .mockResolvedValueOnce(response());
    const auth = new NombaSandboxAuth(credentials, transport, () => start);
    await expect(auth.getAccessToken()).rejects.toThrow(
      'NOMBA_AUTH_UNAVAILABLE',
    );
    expect(await auth.getAccessToken()).toBe('first-token');
  });

  it.each([
    { access_token: '' },
    { access_token: 'bad\ntoken' },
    { refresh_token: '' },
    { expiresAt: 'invalid' },
    { expiresAt: new Date(start).toISOString() },
  ])('rejects unusable token response %j', async (overrides) => {
    const transport = jest
      .fn<Promise<Response>, [string, RequestInit]>()
      .mockResolvedValue(response('first-token', start, overrides));
    const auth = new NombaSandboxAuth(credentials, transport, () => start);
    await expect(auth.getAccessToken()).rejects.toThrow(
      'NOMBA_AUTH_INVALID_RESPONSE',
    );
  });

  it('clears rejected refresh credentials and only reissues on a subsequent operation', async () => {
    let now = start;
    const transport = jest
      .fn<Promise<Response>, [string, RequestInit]>()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockImplementationOnce(() =>
        Promise.resolve(response('new-token', now)),
      );
    const auth = new NombaSandboxAuth(credentials, transport, () => now);
    await auth.getAccessToken();
    now += 1_500_000;
    await expect(auth.getAccessToken()).rejects.toThrow('NOMBA_AUTH_REJECTED');
    expect(transport).toHaveBeenCalledTimes(2);
    expect(await auth.getAccessToken()).toBe('new-token');
    expect(transport.mock.calls[2][0]).toContain('/issue');
  });

  it('authenticates before a bank request and never submits when authentication fails', async () => {
    const authTransport = jest
      .fn<Promise<Response>, [string, RequestInit]>()
      .mockRejectedValue(new Error('network failure'));
    const bankTransport = jest.fn<Promise<Response>, [string, RequestInit]>();
    const auth = new NombaSandboxAuth(credentials, authTransport, () => start);
    const adapter = new NombaAdapter(
      {
        senderName: 'Xend',
        accountId: credentials.accountId,
        accessToken: () => auth.getAccessToken(),
      },
      bankTransport,
    );
    await expect(
      adapter.createAccount({
        reference: 'request',
        accountReference: 'account',
        firstName: 'Test',
        lastName: 'Person',
        email: 'test@example.com',
      }),
    ).rejects.toThrow('NOMBA_AUTH_UNAVAILABLE');
    expect(bankTransport).not.toHaveBeenCalled();
  });

  it('invalidates a rejected token without replaying a bank mutation', async () => {
    const authTransport = jest
      .fn<Promise<Response>, [string, RequestInit]>()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response('second-token'));
    const bankTransport = jest
      .fn<Promise<Response>, [string, RequestInit]>()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: '00', data: [] })),
      );
    const auth = new NombaSandboxAuth(credentials, authTransport, () => start);
    const adapter = new NombaAdapter(
      {
        senderName: 'Xend',
        accountId: credentials.accountId,
        accessToken: () => auth.getAccessToken(),
        onUnauthorized: (token) => auth.invalidate(token),
      },
      bankTransport,
    );
    await expect(
      adapter.createAccount({
        reference: 'request',
        accountReference: 'account',
        firstName: 'Test',
        lastName: 'Person',
        email: 'test@example.com',
      }),
    ).rejects.toThrow('NOMBA_REQUEST_REJECTED');
    expect(bankTransport).toHaveBeenCalledTimes(1);
    expect(authTransport).toHaveBeenCalledTimes(1);
    expect(await adapter.banks()).toEqual([]);
    expect(
      new Headers(bankTransport.mock.calls[1][1].headers).get('Authorization'),
    ).toBe('Bearer second-token');
  });
});

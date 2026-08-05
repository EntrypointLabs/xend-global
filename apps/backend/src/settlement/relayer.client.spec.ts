import type { ConfigService } from '@nestjs/config';
import { RelayerClient } from './relayer.client';
import { RelayerCosignError } from './settlement.errors';

const RELAYER_URL = 'http://relayer.internal:8080';
const AUTH_SECRET = 'shared-secret';

function makeClient(): RelayerClient {
  const config = {
    getOrThrow: (key: string): string => {
      if (key === 'RELAYER_URL') return RELAYER_URL;
      if (key === 'RELAYER_INTERNAL_AUTH_SECRET') return AUTH_SECRET;
      throw new Error(`missing config ${key}`);
    },
  } as unknown as ConfigService;
  const client = new RelayerClient(config);
  client.onModuleInit();
  return client;
}

function mockFetch(response: {
  ok: boolean;
  status?: number;
  body: unknown;
}): jest.Mock {
  const fn = jest.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: () => Promise.resolve(response.body),
  } as unknown as Response);
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('RelayerClient', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends X-Relayer-Auth + X-Correlation-Id and does not follow redirects', async () => {
    const fn = mockFetch({ ok: true, body: { computeUnitPrice: '1000' } });
    const client = makeClient();
    await client.getPriorityFee('pi_abc');

    const [, options] = fn.mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string>;
    expect(headers['X-Relayer-Auth']).toBe(AUTH_SECRET);
    expect(headers['X-Correlation-Id']).toBe('pi_abc');
    expect(options.redirect).toBe('manual');
  });

  it('getPriorityFee parses a decimal-string computeUnitPrice to bigint', async () => {
    mockFetch({ ok: true, body: { computeUnitPrice: '250000' } });
    const client = makeClient();
    const { computeUnitPrice } = await client.getPriorityFee('pi_1');
    expect(computeUnitPrice).toBe(250_000n);
  });

  it('getPriorityFee rejects a non-numeric computeUnitPrice payload', async () => {
    mockFetch({ ok: true, body: { computeUnitPrice: 'not-a-number' } });
    const client = makeClient();
    await expect(client.getPriorityFee('pi_1')).rejects.toThrow(
      RelayerCosignError,
    );
  });

  it('cosign surfaces the relayer error code on non-2xx', async () => {
    mockFetch({
      ok: false,
      status: 429,
      body: { code: 'CONSUMER_CAP_EXCEEDED' },
    });
    const client = makeClient();
    await expect(
      client.cosign(
        {
          intentId: 'pi_1',
          consumerId: 'u_1',
          merchantId: 'm_1',
          transactionBase64: 'AA==',
          expectedSettlementAccount: 'ENDPOINT',
          expectedMessageBase64: 'MSG',
        },
        'pi_1',
      ),
    ).rejects.toMatchObject({
      code: 'RELAYER_COSIGN_FAILED',
      relayerCode: 'CONSUMER_CAP_EXCEEDED',
    });
  });

  it('cosign returns the signature on success', async () => {
    const fn = mockFetch({
      ok: true,
      body: { signature: 'sig-xyz', status: 'BROADCAST' },
    });
    const client = makeClient();
    const { signature } = await client.cosign(
      {
        intentId: 'pi_1',
        consumerId: 'u_1',
        merchantId: 'm_1',
        transactionBase64: 'AA==',
        expectedSettlementAccount: 'ENDPOINT',
        expectedMessageBase64: 'MSG',
      },
      'pi_1',
    );
    expect(signature).toBe('sig-xyz');
    const [url, options] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/internal/cosign');
    expect(options.method).toBe('POST');
    expect(options.redirect).toBe('manual');
  });
});

import type { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { PajClient, PajRequestError } from './paj.client';

const SECRET = 'whsec_test';

function makeClient(overrides: Record<string, unknown> = {}): PajClient {
  const values: Record<string, unknown> = {
    PAJ_API_KEY: 'key_test',
    PAJ_API_BASE: 'https://api.paj.test',
    PAJ_WEBHOOK_SECRET: SECRET,
    ...overrides,
  };
  return new PajClient({
    get: (key: string) => values[key],
    getOrThrow: (key: string) => values[key],
  } as unknown as ConfigService);
}

function sign(timestamp: string, body: Buffer, secret = SECRET): string {
  return `v1=${createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex')}`;
}

describe('PajClient', () => {
  const body = Buffer.from('{"id":"tx_1","status":"COMPLETED"}');
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  describe('verifyWebhookSignature', () => {
    it('accepts a digest over timestamp.body', () => {
      expect(() =>
        makeClient().verifyWebhookSignature(
          body,
          '1788224623',
          sign('1788224623', body),
        ),
      ).not.toThrow();
    });

    it('rejects a body that changed after signing', () => {
      expect(() =>
        makeClient().verifyWebhookSignature(
          Buffer.from('{"id":"tx_1","status":"ERROR"}'),
          '1788224623',
          sign('1788224623', body),
        ),
      ).toThrow('invalid webhook signature');
    });

    it('rejects a timestamp that was moved forward', () => {
      expect(() =>
        makeClient().verifyWebhookSignature(
          body,
          '1788229999',
          sign('1788224623', body),
        ),
      ).toThrow('invalid webhook signature');
    });

    it('rejects a delivery with no signature headers', () => {
      expect(() =>
        makeClient().verifyWebhookSignature(body, undefined, undefined),
      ).toThrow('invalid webhook signature');
    });

    it('refuses to verify with an empty secret', () => {
      expect(() =>
        makeClient({ PAJ_WEBHOOK_SECRET: '' }).verifyWebhookSignature(
          body,
          '1788224623',
          sign('1788224623', body, ''),
        ),
      ).toThrow('not configured');
    });
  });

  it('sends the business key and parses rates', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          onRampRate: { rate: 1397.72, createdAt: '2026-11-10T15:41:49.258Z' },
          offRampRate: { rate: 1376.08, createdAt: '2026-11-10T15:34:47.671Z' },
        }),
    });

    const rates = await makeClient().getRates();

    expect(rates.offRampRate.rate).toBe(1376.08);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.paj.test/pub/v2/rate?currency=NGN');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe(
      'key_test',
    );
  });

  it('rejects a rate that looks like a reciprocal', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          onRampRate: { rate: 0.0007, createdAt: 'x' },
          offRampRate: { rate: 0.0007, createdAt: 'x' },
        }),
    });
    await expect(makeClient().getRates()).rejects.toThrow();
  });

  it('surfaces validation messages from a failed registration', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          message: ['bankCode must be a string', 'bad account'],
        }),
    });

    const failure = makeClient().registerBankAccount({
      bankCode: '',
      accountNumber: '0123456789',
    });

    await expect(failure).rejects.toBeInstanceOf(PajRequestError);
    await expect(failure).rejects.toThrow(
      'bankCode must be a string, bad account',
    );
  });

  it('never calls PAJ without a key', async () => {
    await expect(makeClient({ PAJ_API_KEY: '' }).getRates()).rejects.toThrow(
      'PAJ_API_KEY is not configured',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

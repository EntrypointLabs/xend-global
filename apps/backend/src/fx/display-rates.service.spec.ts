import { ServiceUnavailableException } from '@nestjs/common';
import { DisplayRatesService } from './display-rates.service';
import type { FxQuoteProvider } from './fx-quote-provider.interface';

type Upstream = Record<string, unknown> | Error;

function respond(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

describe('DisplayRatesService', () => {
  const fetchMock = jest.fn();
  let ngn: jest.Mocked<FxQuoteProvider>;
  let service: DisplayRatesService;

  /** Answers the ECB call with `market` and the wide feed with `wide`. */
  function upstreams(market: Upstream, wide: Upstream = new Error('down')) {
    fetchMock.mockImplementation((url: string) => {
      const source = url.includes('frankfurter') ? market : wide;
      if (source instanceof Error) return Promise.reject(source);
      return Promise.resolve(
        respond(
          url.includes('frankfurter') ? { rates: source } : { usd: source },
        ),
      );
    });
  }

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-18T12:00:00Z') });
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    ngn = { getQuote: jest.fn() };
    ngn.getQuote.mockRejectedValue(new Error('down'));
    service = new DisplayRatesService(ngn);
  });

  afterEach(() => jest.useRealTimers());

  it('merges market rates with the NGN checkout quote', async () => {
    upstreams({ GBP: 0.79, EUR: 0.92 });
    ngn.getQuote.mockResolvedValue({
      ngnPerUsdc: '1530.25',
      source: 'paj',
      quotedAt: new Date(),
    });

    const rates = await service.current();

    expect(rates.perUsd).toEqual({
      USD: 1,
      GBP: 0.79,
      EUR: 0.92,
      NGN: 1530.25,
    });
  });

  it('fills currencies the ECB lacks from the wide feed, ECB winning overlaps', async () => {
    upstreams({ GBP: 0.79 }, { gbp: 0.8, ghs: 11.7, kes: 130, aed: 3.67 });

    const rates = await service.current();

    expect(rates.perUsd).toMatchObject({
      GBP: 0.79,
      GHS: 11.7,
      KES: 130,
      AED: 3.67,
    });
  });

  it('keeps only ISO currencies from the wide feed', async () => {
    upstreams(new Error('down'), { ghs: 11.7, btc: 0.00001, xyzq: 3 });

    const rates = await service.current();

    expect(rates.perUsd).toEqual({ GHS: 11.7 });
  });

  it('prefers the NGN checkout quote over the wide feed', async () => {
    upstreams(new Error('down'), { ngn: 1350 });
    ngn.getQuote.mockResolvedValue({
      ngnPerUsdc: '1530.25',
      source: 'paj',
      quotedAt: new Date(),
    });

    const rates = await service.current();

    expect(rates.perUsd.NGN).toBe(1530.25);
  });

  it('drops values that are not positive numbers', async () => {
    upstreams({ GBP: 0.79, BAD: 'x', ZERO: 0, NEG: -1 });

    const rates = await service.current();

    expect(rates.perUsd).toEqual({ USD: 1, GBP: 0.79 });
  });

  it('reuses an answer for an hour', async () => {
    upstreams({ GBP: 0.79 });

    await service.current();
    const calls = fetchMock.mock.calls.length;
    jest.advanceTimersByTime(59 * 60_000);
    await service.current();

    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });

  it('keeps the last good rates when every upstream fails', async () => {
    upstreams({ GBP: 0.79 });
    const first = await service.current();

    jest.advanceTimersByTime(61 * 60_000);
    upstreams(new Error('timeout'));
    const second = await service.current();

    expect(second.perUsd.GBP).toBe(0.79);
    expect(second.quotedAt).toBe(first.quotedAt);
  });

  it('answers 503 when no rate has ever been fetched', async () => {
    upstreams(new Error('timeout'));

    await expect(service.current()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

import { ServiceUnavailableException } from '@nestjs/common';
import { DisplayRatesService } from './display-rates.service';
import type { FxQuoteProvider } from './fx-quote-provider.interface';

function marketResponse(rates: Record<string, unknown>) {
  return { ok: true, status: 200, json: () => Promise.resolve({ rates }) };
}

describe('DisplayRatesService', () => {
  const fetchMock = jest.fn();
  let ngn: jest.Mocked<FxQuoteProvider>;
  let service: DisplayRatesService;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-18T12:00:00Z') });
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    ngn = { getQuote: jest.fn() };
    service = new DisplayRatesService(ngn);
  });

  afterEach(() => jest.useRealTimers());

  it('merges market rates with the NGN checkout quote', async () => {
    fetchMock.mockResolvedValue(marketResponse({ GBP: 0.79, EUR: 0.92 }));
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

  it('drops values that are not positive numbers', async () => {
    fetchMock.mockResolvedValue(
      marketResponse({ GBP: 0.79, BAD: 'x', ZERO: 0, NEG: -1 }),
    );
    ngn.getQuote.mockRejectedValue(new Error('down'));

    const rates = await service.current();

    expect(rates.perUsd).toEqual({ USD: 1, GBP: 0.79 });
  });

  it('reuses an answer for an hour', async () => {
    fetchMock.mockResolvedValue(marketResponse({ GBP: 0.79 }));
    ngn.getQuote.mockRejectedValue(new Error('down'));

    await service.current();
    jest.advanceTimersByTime(59 * 60_000);
    await service.current();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the last good rates when every upstream fails', async () => {
    fetchMock.mockResolvedValueOnce(marketResponse({ GBP: 0.79 }));
    ngn.getQuote.mockRejectedValue(new Error('down'));
    const first = await service.current();

    jest.advanceTimersByTime(61 * 60_000);
    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    const second = await service.current();

    expect(second.perUsd.GBP).toBe(0.79);
    expect(second.quotedAt).toBe(first.quotedAt);
  });

  it('answers 503 when no rate has ever been fetched', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'));
    ngn.getQuote.mockRejectedValue(new Error('down'));

    await expect(service.current()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

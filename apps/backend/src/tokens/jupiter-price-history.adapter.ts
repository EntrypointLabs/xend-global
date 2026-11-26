import { Injectable } from '@nestjs/common';
import type {
  HistoryWindow,
  PricePoint,
  TokenPriceHistoryProvider,
} from './token-market.interface';

/**
 * Keyless and keyed by mint. Undocumented: it is what jup.ag's own token pages
 * chart from, so it is reached only through TOKEN_PRICE_HISTORY_PROVIDER and
 * can be swapped without touching callers.
 */
const CHART_ENDPOINT = 'https://datapi.jup.ag/v2/charts';

const REQUEST_TIMEOUT_MS = 5_000;

const INTERVALS = new Map<number, string>([
  [60, '1_MINUTE'],
  [5 * 60, '5_MINUTE'],
  [15 * 60, '15_MINUTE'],
  [30 * 60, '30_MINUTE'],
  [60 * 60, '1_HOUR'],
  [2 * 60 * 60, '2_HOUR'],
  [4 * 60 * 60, '4_HOUR'],
  [8 * 60 * 60, '8_HOUR'],
  [12 * 60 * 60, '12_HOUR'],
  [24 * 60 * 60, '1_DAY'],
  [7 * 24 * 60 * 60, '1_WEEK'],
]);

interface JupiterCandle {
  time?: number;
  close?: number;
}

@Injectable()
export class JupiterPriceHistoryAdapter implements TokenPriceHistoryProvider {
  async getHistory(mint: string, window: HistoryWindow): Promise<PricePoint[]> {
    const interval = INTERVALS.get(window.bucketSeconds);
    if (!interval) {
      throw new Error(`unsupported bucket: ${window.bucketSeconds}s`);
    }

    const params = new URLSearchParams({
      interval,
      to: String(Date.now()),
      candles: String(window.count),
      type: 'price',
    });
    const res = await fetch(
      `${CHART_ENDPOINT}/${encodeURIComponent(mint)}?${params.toString()}`,
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    );
    if (!res.ok) throw new Error(`jupiter chart lookup failed: ${res.status}`);

    const body = (await res.json()) as { candles?: JupiterCandle[] };
    const candles = Array.isArray(body?.candles) ? body.candles : [];
    return candles
      .filter(
        (c): c is Required<JupiterCandle> =>
          typeof c.time === 'number' &&
          Number.isFinite(c.time) &&
          typeof c.close === 'number' &&
          Number.isFinite(c.close) &&
          c.close >= 0,
      )
      .map((c) => ({ at: new Date(c.time * 1000), priceUsd: c.close }))
      .sort((a, b) => a.at.getTime() - b.at.getTime());
  }
}

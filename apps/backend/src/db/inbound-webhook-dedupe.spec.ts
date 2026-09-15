import { HttpException } from '@nestjs/common';
import type { DbService } from './db.service';
import {
  InboundWebhookDedupe,
  assertFreshTimestamp,
} from './inbound-webhook-dedupe';

const NOW = Date.parse('2026-09-07T12:00:00.000Z');

describe('assertFreshTimestamp', () => {
  it('accepts unix seconds, unix milliseconds and ISO-8601 inside the window', () => {
    const fourMinutesAgo = NOW - 4 * 60 * 1000;
    expect(() =>
      assertFreshTimestamp(String(Math.floor(fourMinutesAgo / 1000)), NOW),
    ).not.toThrow();
    expect(() =>
      assertFreshTimestamp(String(fourMinutesAgo), NOW),
    ).not.toThrow();
    expect(() =>
      assertFreshTimestamp(new Date(fourMinutesAgo).toISOString(), NOW),
    ).not.toThrow();
  });

  it('rejects a delivery more than five minutes old or ahead', () => {
    const sixMinutes = 6 * 60 * 1000;
    expect(() => assertFreshTimestamp(String(NOW - sixMinutes), NOW)).toThrow(
      HttpException,
    );
    expect(() => assertFreshTimestamp(String(NOW + sixMinutes), NOW)).toThrow(
      HttpException,
    );
  });

  it('rejects a timestamp it cannot read rather than waving it through', () => {
    expect(() => assertFreshTimestamp('yesterday', NOW)).toThrow(HttpException);
  });
});

describe('InboundWebhookDedupe', () => {
  function makeDb(): { db: DbService; rows: Set<string> } {
    const rows = new Set<string>();
    const client = {
      insert: () => ({
        values: (row: { provider: string; eventId: string }) => ({
          onConflictDoNothing: () => ({
            returning: () => {
              const key = `${row.provider}/${row.eventId}`;
              if (rows.has(key)) return Promise.resolve([]);
              rows.add(key);
              return Promise.resolve([{ eventId: row.eventId }]);
            },
          }),
        }),
      }),
      delete: () => ({
        where: () => {
          rows.clear();
          return Promise.resolve();
        },
      }),
    };
    return { db: { client } as unknown as DbService, rows };
  }

  it('claims an id once and reports the second delivery as a replay', async () => {
    const { db } = makeDb();
    const dedupe = new InboundWebhookDedupe(db);
    await expect(dedupe.claim('blockradar', 'evt_1')).resolves.toBe(true);
    await expect(dedupe.claim('blockradar', 'evt_1')).resolves.toBe(false);
    await expect(dedupe.claim('helius', 'evt_1')).resolves.toBe(true);
  });

  it('lets a released id be claimed again', async () => {
    const { db } = makeDb();
    const dedupe = new InboundWebhookDedupe(db);
    await dedupe.claim('blockradar', 'evt_1');
    await dedupe.release('blockradar', 'evt_1');
    await expect(dedupe.claim('blockradar', 'evt_1')).resolves.toBe(true);
  });
});

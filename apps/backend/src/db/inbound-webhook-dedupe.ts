import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DbService } from './db.service';
import { inboundWebhookEvents } from './schema';

export const WEBHOOK_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * Replay protection for inbound provider webhooks. A delivery is claimed by
 * its provider event id before any side effect; a second delivery with the
 * same id finds the claim and does nothing. A claim is released when handling
 * fails, so the provider's own redelivery is not turned into a silent drop.
 */
@Injectable()
export class InboundWebhookDedupe {
  constructor(private readonly db: DbService) {}

  /** True when this delivery is the first with that id. */
  async claim(provider: string, eventId: string): Promise<boolean> {
    const inserted = await this.db.client
      .insert(inboundWebhookEvents)
      .values({ provider, eventId })
      .onConflictDoNothing()
      .returning({ eventId: inboundWebhookEvents.eventId });
    return inserted.length > 0;
  }

  async release(provider: string, eventId: string): Promise<void> {
    await this.db.client
      .delete(inboundWebhookEvents)
      .where(
        and(
          eq(inboundWebhookEvents.provider, provider),
          eq(inboundWebhookEvents.eventId, eventId),
        ),
      );
  }
}

/**
 * Rejects a delivery whose provider timestamp is outside the tolerance
 * window. Unix seconds, unix milliseconds and ISO-8601 are all accepted; an
 * unparseable value is rejected rather than waved through, because a header
 * the provider sends is a header an attacker replaying the body must match.
 */
export function assertFreshTimestamp(
  header: string,
  now: number = Date.now(),
  toleranceMs: number = WEBHOOK_TIMESTAMP_TOLERANCE_MS,
): void {
  const at = parseTimestamp(header);
  if (at === null || Math.abs(now - at) > toleranceMs) {
    throw new HttpException(
      'webhook timestamp outside tolerance',
      HttpStatus.UNAUTHORIZED,
    );
  }
}

function parseTimestamp(raw: string): number | null {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    return trimmed.length <= 10 ? n * 1000 : n;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

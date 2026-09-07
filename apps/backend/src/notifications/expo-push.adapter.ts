import { Injectable, Logger } from '@nestjs/common';
import type { PushMessage, PushSender } from './push-sender.interface';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

const REQUEST_TIMEOUT_MS = 5_000;

/** Expo accepts at most 100 messages per request. */
const BATCH_SIZE = 100;

interface ExpoTicket {
  status?: string;
  details?: { error?: string };
}

/**
 * Sends through Expo's push service, which fans out to APNs and FCM.
 *
 * Chosen because the app is an Expo build and its tokens are Expo tokens;
 * talking to APNs and FCM directly would mean holding two more sets of
 * credentials to reach the same devices.
 *
 * `DeviceNotRegistered` is the provider's way of saying a token is dead for
 * good, and is the only failure treated as permanent.
 */
@Injectable()
export class ExpoPushAdapter implements PushSender {
  private readonly logger = new Logger(ExpoPushAdapter.name);

  async send(messages: PushMessage[]): Promise<{ invalidTokens: string[] }> {
    const invalidTokens: string[] = [];
    if (messages.length === 0) return { invalidTokens };

    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE);
      try {
        const res = await fetch(EXPO_PUSH_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            batch.map((m) => ({
              to: m.token,
              title: m.title,
              body: m.body,
              ...(m.data ? { data: m.data } : {}),
              sound: 'default',
            })),
          ),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) {
          this.logger.warn(`push.send failed: ${res.status}`);
          continue;
        }

        const body = (await res.json()) as { data?: ExpoTicket[] };
        (body.data ?? []).forEach((ticket, index) => {
          if (ticket.status !== 'error') return;
          if (ticket.details?.error === 'DeviceNotRegistered') {
            invalidTokens.push(batch[index].token);
            return;
          }
          this.logger.warn(`push.ticket error: ${ticket.details?.error}`);
        });
      } catch (err) {
        // A notification is decoration on top of something that already
        // happened; it must never take that down with it.
        this.logger.warn('push.send unavailable', err);
      }
    }

    return { invalidTokens };
  }
}

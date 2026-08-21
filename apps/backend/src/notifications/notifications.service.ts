import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { pushDevices, users } from '../db/schema';
import { PUSH_SENDER } from './push-sender.interface';
import type { PushSender } from './push-sender.interface';

export interface ArrivalNotice {
  smartAccountId: string;
  /** Already scaled and formatted: "5 SOL", "10 USDC". */
  amount: string;
}

/**
 * Tells a Consumer money arrived, on the devices they asked to be told on.
 *
 * Everything here is best-effort. The transfer is already recorded and the
 * balance already moved; failing to mention it must not undo either.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly db: DbService,
    @Inject(PUSH_SENDER) private readonly push: PushSender,
  ) {}

  /** Records where a Consumer's notifications should go. */
  async registerDevice(params: {
    userId: string;
    token: string;
    platform: string;
  }): Promise<void> {
    // Re-registering the same token under a new user happens on a shared
    // device, and the newest sign-in owns it. Nothing about the Consumer's
    // preference is stored here, so there is nothing for the new owner to
    // inherit.
    await this.db.client
      .insert(pushDevices)
      .values({
        userId: params.userId,
        token: params.token,
        platform: params.platform,
      })
      .onConflictDoUpdate({
        target: pushDevices.token,
        set: { userId: params.userId, updatedAt: new Date() },
      });
  }

  /**
   * The Consumer's own answer about whether they want to be told.
   *
   * Recorded against the person, so it survives having no device registered
   * yet and is not inherited by whoever signs in on that device next.
   */
  async setEnabled(userId: string, enabled: boolean): Promise<void> {
    await this.db.client
      .update(users)
      .set({ notificationsEnabled: enabled, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  async isEnabled(userId: string): Promise<boolean> {
    const [row] = await this.db.client
      .select({ enabled: users.notificationsEnabled })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.enabled ?? true;
  }

  /**
   * Announces an arrival to every enabled device of the account's owner.
   *
   * Takes the smart account rather than the user because that is what the
   * tailer holds when a transfer lands.
   */
  async notifyArrival(notice: ArrivalNotice): Promise<void> {
    try {
      // The owner is reached through smart_accounts: the tailer knows the
      // account a transfer belongs to, never the person behind it.
      const result = (await this.db.client.execute(sql`
        SELECT pd.token
        FROM push_devices pd
        JOIN smart_accounts sa ON sa.user_id = pd.user_id
        JOIN users u ON u.id = pd.user_id
        WHERE sa.id = ${notice.smartAccountId}
          AND u.notifications_enabled = true
      `)) as unknown as { rows: { token: string }[] };
      const tokens = result.rows ?? [];
      if (tokens.length === 0) return;

      const { invalidTokens } = await this.push.send(
        tokens.map((d) => ({
          token: d.token,
          title: 'Money in',
          body: `You received ${notice.amount}`,
        })),
      );

      // Says a notice went out. Confirming an arrival was announced otherwise
      // means reading the device's notification shade, which is no way to
      // check whether a delivery path is alive.
      this.logger.log(
        `push.sent devices=${tokens.length} amount=${notice.amount}`,
      );

      if (invalidTokens.length > 0) {
        await this.db.client
          .delete(pushDevices)
          .where(inArray(pushDevices.token, invalidTokens));
        this.logger.log(`push.forgot_devices count=${invalidTokens.length}`);
      }
    } catch (err) {
      this.logger.warn('push.notify_failed', err);
    }
  }
}

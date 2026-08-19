import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { pushDevices } from '../db/schema';
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
    // device, and the newest sign-in owns it. Enablement is deliberately not
    // reset here: it is the Consumer's setting, not the installation's.
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

  /** The Consumer's own answer about whether they want to be told. */
  async setEnabled(userId: string, enabled: boolean): Promise<void> {
    await this.db.client
      .update(pushDevices)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(pushDevices.userId, userId));
  }

  async isEnabled(userId: string): Promise<boolean> {
    const rows = await this.db.client
      .select({ enabled: pushDevices.enabled })
      .from(pushDevices)
      .where(eq(pushDevices.userId, userId));
    // No device registered reads as "on": nothing has been silenced, there is
    // simply nowhere to deliver yet.
    return rows.length === 0 || rows.some((r) => r.enabled);
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
        WHERE sa.id = ${notice.smartAccountId}
          AND pd.enabled = true
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

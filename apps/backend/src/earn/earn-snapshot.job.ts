import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { EARN_RECORDS, type EarnRecords } from './earn-records';
import { EarnService } from './earn.service';

/**
 * Late in the UTC day so the stored point is close to that day's closing
 * value. A Consumer opening Earn later the same day overwrites it anyway.
 */
const SNAPSHOT_CRON = '0 50 23 * * *';

/**
 * Gives every Earn position a point for days its owner never opened the app.
 * Accounts are read one at a time to keep RPC load flat.
 */
@Injectable()
export class EarnSnapshotJob {
  private readonly logger = new Logger(EarnSnapshotJob.name);
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly earn: EarnService,
    @Inject(EARN_RECORDS) private readonly records: EarnRecords,
  ) {}

  @Cron(SNAPSHOT_CRON, { timeZone: 'UTC' })
  async tick(): Promise<void> {
    if (this.config.get<string>('SOLANA_CLUSTER') !== 'mainnet') return;
    if (this.running) return;
    this.running = true;
    try {
      const users = await this.records.usersWithEarn();
      let failed = 0;
      for (const userId of users) {
        try {
          await this.earn.snapshot(userId);
        } catch (err) {
          failed += 1;
          this.logger.warn(`earn.snapshot_failed user=${userId}`, err);
        }
      }
      this.logger.log(
        `earn.snapshots count=${users.length - failed} failed=${failed}`,
      );
    } catch (err) {
      this.logger.warn('earn.snapshots_failed', err);
    } finally {
      this.running = false;
    }
  }
}

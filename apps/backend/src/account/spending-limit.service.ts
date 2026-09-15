import { Inject, Injectable, Logger } from '@nestjs/common';
import type { SpendingLimit } from '@xend/smart-account';

import { SPEND_CHAIN } from './account.interface';
import type { SpendChain } from './account.interface';
import type { SpendingLimitResponse } from './dtos';

/**
 * The Consumer's spending limit, in the shape the app can warn with.
 *
 * Exists so a Consumer learns that a Spend takes two confirmations while they
 * are still typing the amount, rather than when the second prompt appears.
 * Nothing here decides how a Spend is signed: that is settled at prepare time
 * from the same policy, and this is a read of it.
 */
@Injectable()
export class SpendingLimitService {
  private readonly logger = new Logger(SpendingLimitService.name);

  constructor(@Inject(SPEND_CHAIN) private readonly chain: SpendChain) {}

  /**
   * Null when the Account has no limit, and also when the limit cannot be read.
   *
   * Conflating the two is deliberate here and would not be in the spend path.
   * A Consumer whose limit is unreadable is told every Spend takes two
   * confirmations, which is what an unreadable limit actually produces: the
   * route falls back to two signatures whenever nothing positively admits the
   * Spend. Failing the whole call instead would take the vault address and the
   * sub-organization id down with it, and those are what the app needs to
   * function at all.
   */
  async forAccount(
    settingsAddress: string,
    policySeed: bigint,
  ): Promise<SpendingLimitResponse | null> {
    let limits: readonly SpendingLimit[];
    try {
      limits = await this.chain.readSpendingLimits(settingsAddress, policySeed);
    } catch (cause) {
      this.logger.warn(
        `account.spending_limit_unreadable settings=${settingsAddress}: ${describe(cause)}`,
      );
      return null;
    }

    const [limit] = limits;
    if (!limit) return null;

    return {
      mint: limit.mint.toBase58(),
      maxPerUse: limit.maxPerUse.toString(),
      maxPerPeriod: limit.maxPerPeriod.toString(),
      remainingInPeriod: limit.remainingInPeriod.toString(),
      period: limit.period,
    };
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

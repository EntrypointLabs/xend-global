import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { smartAccounts } from '../db/schema';
import { SOLANA_RPC } from '../solana/solana-rpc.interface';
import type { SolanaRpc } from '../solana/solana-rpc.interface';
import { RATE_COUNTER } from '../counters/rate-counter.interface';
import type { RateCounter } from '../counters/rate-counter.interface';
import { parseTierTable, type TierBand } from './tier-config';
import {
  CapacityExceededError,
  InsufficientBalanceError,
  UnknownConsumerError,
} from './capability.errors';

/** Day counters outlive their UTC day by a couple of hours for clock skew. */
const DAY_COUNTER_TTL_SECONDS = 26 * 60 * 60;
/** Month counters outlive their UTC month by a couple of days. */
const MONTH_COUNTER_TTL_SECONDS = 32 * 24 * 60 * 60;

export interface CapabilitySnapshot {
  consumerId: string;
  accountAddress: string;
  balanceRaw: string;
  tier: string;
  limits: TierBand;
  usedTodayRaw: string;
  usedThisMonthRaw: string;
  riskFlags: string[];
  boost: null;
}

/**
 * Greenfield tier/limit capacity engine, load-bearing for the no-KYC
 * compliance stance: every Payment passes a capacity check against tier caps
 * and live Balance. Limits are evaluated live per check and never frozen into
 * a session or cached object; Balance is read live through SOLANA_RPC with no
 * caching layer (correctness before latency).
 */
@Injectable()
export class CapacityService implements OnModuleInit {
  private readonly logger = new Logger(CapacityService.name);
  private tiers!: Record<string, TierBand>;
  private defaultTier!: string;
  private usdcMint!: string;

  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
    @Inject(SOLANA_RPC) private readonly solana: SolanaRpc,
    @Inject(RATE_COUNTER) private readonly counter: RateCounter,
  ) {}

  onModuleInit() {
    this.defaultTier = this.config.getOrThrow<string>('CAPACITY_DEFAULT_TIER');
    this.tiers = parseTierTable(
      this.config.getOrThrow<string>('CAPACITY_TIERS'),
      this.defaultTier,
    );
    const mint = this.config.getOrThrow<string>(
      'EXPO_PUBLIC_USDC_MINT_ADDRESS',
    );
    // Belt and braces with the Joi required() change: a present-but-empty
    // mint would silently zero every Balance read, so fail loud at boot.
    if (!mint) {
      throw new Error('EXPO_PUBLIC_USDC_MINT_ADDRESS must be non-empty');
    }
    this.usdcMint = mint;
    this.logger.log(
      `capacity.init default_tier=${this.defaultTier} tiers=${Object.keys(
        this.tiers,
      ).join(',')}`,
    );
  }

  /**
   * The default tier today. KYC-driven tier promotion attaches here later;
   * kept a real method (not an inlined constant) so that seam exists.
   */
  getTierForConsumer(consumerId: string): string {
    void consumerId;
    return this.defaultTier;
  }

  async getCapability(consumerId: string): Promise<CapabilitySnapshot> {
    const [account] = await this.db.client
      .select()
      .from(smartAccounts)
      .where(eq(smartAccounts.userId, consumerId))
      .limit(1);
    if (!account) {
      throw new UnknownConsumerError(`no Account for consumer ${consumerId}`);
    }

    const balances = await this.solana.getTokenBalances(account.walletAddress);
    let balance = 0n;
    for (const b of balances) {
      if (b.mint === this.usdcMint) balance += b.amountRaw;
    }

    const now = new Date();
    const tier = this.getTierForConsumer(consumerId);
    const limits = this.tiers[tier];
    if (!limits) {
      throw new Error(`tier '${tier}' missing from tier table`);
    }

    const day = await this.counter.peek(this.dayKey(consumerId, now));
    const month = await this.counter.peek(this.monthKey(consumerId, now));

    return {
      consumerId,
      accountAddress: account.walletAddress,
      balanceRaw: balance.toString(),
      tier,
      limits,
      usedTodayRaw: day.totalRaw,
      usedThisMonthRaw: month.totalRaw,
      riskFlags: [],
      // Reserved: credit capability slots in here later; the field exists so
      // the response shape does not break when it does.
      boost: null,
    };
  }

  async checkCapacity(
    consumerId: string,
    amountRaw: string,
  ): Promise<CapabilitySnapshot> {
    const capability = await this.getCapability(consumerId);
    const amount = BigInt(amountRaw);
    const { limits } = capability;
    const log = (allowed: boolean) =>
      this.logger.log(
        `capacity.check consumer_id=${consumerId} tier=${capability.tier} amount_raw=${amountRaw} allowed=${allowed}`,
      );

    if (amount > BigInt(limits.perPaymentMaxRaw)) {
      log(false);
      throw new CapacityExceededError(
        'PER_PAYMENT_CAP',
        `amount ${amountRaw} exceeds per-payment cap ${limits.perPaymentMaxRaw}`,
      );
    }
    if (BigInt(capability.usedTodayRaw) + amount > BigInt(limits.dailyCapRaw)) {
      log(false);
      throw new CapacityExceededError(
        'DAILY_CAP',
        `amount ${amountRaw} would exceed daily cap ${limits.dailyCapRaw}`,
      );
    }
    if (
      BigInt(capability.usedThisMonthRaw) + amount >
      BigInt(limits.monthlyCapRaw)
    ) {
      log(false);
      throw new CapacityExceededError(
        'MONTHLY_CAP',
        `amount ${amountRaw} would exceed monthly cap ${limits.monthlyCapRaw}`,
      );
    }
    if (amount > BigInt(capability.balanceRaw)) {
      log(false);
      throw new InsufficientBalanceError(
        `amount ${amountRaw} exceeds balance ${capability.balanceRaw}`,
      );
    }

    log(true);
    return capability;
  }

  async recordAuthorizedPayment(
    consumerId: string,
    amountRaw: string,
  ): Promise<void> {
    const now = new Date();
    await this.counter.increment(
      this.dayKey(consumerId, now),
      amountRaw,
      DAY_COUNTER_TTL_SECONDS,
    );
    await this.counter.increment(
      this.monthKey(consumerId, now),
      amountRaw,
      MONTH_COUNTER_TTL_SECONDS,
    );
  }

  private dayKey(consumerId: string, now: Date): string {
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    return `cap:consumer:${consumerId}:day:${y}${m}${d}`;
  }

  private monthKey(consumerId: string, now: Date): string {
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `cap:consumer:${consumerId}:month:${y}${m}`;
  }
}

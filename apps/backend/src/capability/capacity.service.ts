import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { smartAccounts } from '../db/schema';
import { SOLANA_RPC } from '../solana/solana-rpc.interface';
import type { SolanaRpc } from '../solana/solana-rpc.interface';
import { CAPACITY_COUNTER } from '../counters/rate-counter.interface';
import type { ReservingRateCounter } from '../counters/rate-counter.interface';
import { parseTierTable, type TierBand } from './tier-config';
import {
  CapacityExceededError,
  InsufficientBalanceError,
  UnknownConsumerError,
} from './capability.errors';
import { findVaultAddress } from './vault-address';
import { capacityReservationsRefused } from '../metrics/metrics';

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
    @Inject(CAPACITY_COUNTER) private readonly counter: ReservingRateCounter,
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
    const accountAddress = await this.accountAddress(consumerId);

    const balances = await this.solana.getTokenBalances(accountAddress);
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
      accountAddress,
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

  /**
   * Read-only preview: the same refusals reserveCapacity gives, without
   * spending anything. Two callers can both pass this and only one can then
   * reserve, so it decides nothing on its own.
   */
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

    this.assertPerPaymentAndBalance(capability, amount, amountRaw, log);
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
    log(true);
    return capability;
  }

  /**
   * Spends capacity for a Payment: the day and month windows are incremented
   * and compared against their caps in one atomic step each, and rolled back
   * on overshoot, so concurrent authorizations cannot add up past a cap the
   * way a read-then-increment could. Returns the snapshot after the spend.
   */
  async reserveCapacity(
    consumerId: string,
    amountRaw: string,
  ): Promise<CapabilitySnapshot> {
    try {
      return await this.reserve(consumerId, amountRaw);
    } catch (err) {
      if (err instanceof CapacityExceededError) {
        capacityReservationsRefused.inc({ reason: err.reason.toLowerCase() });
      } else if (err instanceof InsufficientBalanceError) {
        capacityReservationsRefused.inc({ reason: 'insufficient_balance' });
      }
      throw err;
    }
  }

  private async reserve(
    consumerId: string,
    amountRaw: string,
  ): Promise<CapabilitySnapshot> {
    const capability = await this.getCapability(consumerId);
    const amount = BigInt(amountRaw);
    const { limits } = capability;
    const log = (allowed: boolean) =>
      this.logger.log(
        `capacity.reserve consumer_id=${consumerId} tier=${capability.tier} amount_raw=${amountRaw} allowed=${allowed}`,
      );

    this.assertPerPaymentAndBalance(capability, amount, amountRaw, log);

    const now = new Date();
    const dayKey = this.dayKey(consumerId, now);
    const monthKey = this.monthKey(consumerId, now);
    const day = await this.counter.reserve(
      dayKey,
      amountRaw,
      limits.dailyCapRaw,
      DAY_COUNTER_TTL_SECONDS,
    );
    if (!day.allowed) {
      log(false);
      throw new CapacityExceededError(
        'DAILY_CAP',
        `amount ${amountRaw} would exceed daily cap ${limits.dailyCapRaw}`,
      );
    }
    const month = await this.counter.reserve(
      monthKey,
      amountRaw,
      limits.monthlyCapRaw,
      MONTH_COUNTER_TTL_SECONDS,
    );
    if (!month.allowed) {
      await this.counter.release(dayKey, amountRaw);
      log(false);
      throw new CapacityExceededError(
        'MONTHLY_CAP',
        `amount ${amountRaw} would exceed monthly cap ${limits.monthlyCapRaw}`,
      );
    }

    log(true);
    return {
      ...capability,
      usedTodayRaw: day.snapshot.totalRaw,
      usedThisMonthRaw: month.snapshot.totalRaw,
    };
  }

  /** Undoes reserveCapacity for a Payment that did not get authorized. */
  async releaseCapacity(consumerId: string, amountRaw: string): Promise<void> {
    const now = new Date();
    await this.counter.release(this.dayKey(consumerId, now), amountRaw);
    await this.counter.release(this.monthKey(consumerId, now), amountRaw);
  }

  private assertPerPaymentAndBalance(
    capability: CapabilitySnapshot,
    amount: bigint,
    amountRaw: string,
    log: (allowed: boolean) => void,
  ): void {
    const { limits } = capability;
    if (amount > BigInt(limits.perPaymentMaxRaw)) {
      log(false);
      throw new CapacityExceededError(
        'PER_PAYMENT_CAP',
        `amount ${amountRaw} exceeds per-payment cap ${limits.perPaymentMaxRaw}`,
      );
    }
    // TEST ONLY, never production. Skipped only while development is also
    // short-circuiting settlement, where the Consumer has no Account on any
    // cluster and every Balance reads zero. Turning the real Payment path on
    // turns this back on with it: at that point the vault is real and holds
    // real money, and skipping the gate would hide the one refusal a Consumer
    // is most likely to meet. The tier caps above apply either way.
    const devSkipBalance =
      this.config.get<string>('NODE_ENV') === 'development' &&
      this.config.get<boolean>('CHECKOUT_DEV_FORCE_SETTLE') !== false;
    if (!devSkipBalance && amount > BigInt(capability.balanceRaw)) {
      log(false);
      throw new InsufficientBalanceError(
        `amount ${amountRaw} exceeds balance ${capability.balanceRaw}`,
      );
    }
  }

  /**
   * The vault the Balance is read from. Not the Privy wallet: a limit checked
   * against a signer's address rather than the Account's would let every
   * Payment through on an empty read.
   */
  private async accountAddress(consumerId: string): Promise<string> {
    const vault = await findVaultAddress(this.db, consumerId);
    if (vault) return vault;

    // TEST ONLY, never production. A dev-provisioned Consumer has no Account
    // on any cluster; the balance gate below is already skipped in development,
    // so the Privy wallet stands in only to keep the snapshot shape whole.
    if (this.config.get<string>('NODE_ENV') === 'development') {
      const [account] = await this.db.client
        .select()
        .from(smartAccounts)
        .where(eq(smartAccounts.userId, consumerId))
        .limit(1);
      if (account) return account.walletAddress;
    }

    throw new UnknownConsumerError(`no Account for consumer ${consumerId}`);
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

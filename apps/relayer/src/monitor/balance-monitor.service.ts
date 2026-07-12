import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { RELAYER_CONFIG, type RelayerConfig } from "../relayer-config";
import { RelayerRpc } from "../rpc/relayer-rpc";
import { CapsService } from "../caps/caps.service";

/** Alert when global daily spend crosses 80% of the cap (slope, not level). */
const SPEND_WARN_NUMERATOR = 4n;
const SPEND_WARN_DENOMINATOR = 5n;

/**
 * Fee-payer health monitor. A drained fee payer is a full checkout outage
 * (PITFALLS.md; ARCHITECTURE.md 5.4), so balance monitoring is launch-
 * blocking. Emits a structured alert line and, if configured, a best-effort
 * POST to RELAYER_ALERT_WEBHOOK_URL.
 */
@Injectable()
export class BalanceMonitorService {
  private readonly logger = new Logger("BalanceMonitor");

  constructor(
    @Inject(RELAYER_CONFIG) private readonly cfg: RelayerConfig,
    private readonly rpc: RelayerRpc,
    private readonly caps: CapsService,
    private readonly config: ConfigService,
  ) {}

  @Cron("0 */2 * * * *")
  async tick(): Promise<void> {
    await this.check();
  }

  async check(): Promise<void> {
    let balance: bigint;
    try {
      balance = await this.rpc.getBalanceLamports(this.cfg.feePayerAddress);
    } catch (err) {
      this.logger.warn(`relayer.balance.check_failed ${String(err)}`);
      return;
    }
    if (balance < this.cfg.minFeePayerBalanceLamports) {
      this.logger.warn(
        `relayer.balance.alert level=low balance_lamports=${balance} threshold_lamports=${this.cfg.minFeePayerBalanceLamports}`,
      );
      void this.postAlert({
        type: "fee_payer_low_balance",
        balanceLamports: balance.toString(),
        thresholdLamports: this.cfg.minFeePayerBalanceLamports.toString(),
      });
    }

    const spentToday = this.caps.globalFeeLamportsToday();
    const warnAt =
      (this.cfg.globalFeeLamportsPerDay * SPEND_WARN_NUMERATOR) /
      SPEND_WARN_DENOMINATOR;
    if (spentToday > warnAt) {
      this.logger.warn(
        `relayer.balance.alert level=spend_slope spent_today_lamports=${spentToday} daily_cap_lamports=${this.cfg.globalFeeLamportsPerDay}`,
      );
      void this.postAlert({
        type: "global_spend_slope",
        spentTodayLamports: spentToday.toString(),
        dailyCapLamports: this.cfg.globalFeeLamportsPerDay.toString(),
      });
    }
  }

  private async postAlert(payload: Record<string, string>): Promise<void> {
    const url = this.config.get<string>("RELAYER_ALERT_WEBHOOK_URL");
    if (!url) return;
    try {
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      this.logger.warn(`relayer.balance.alert_post_failed ${String(err)}`);
    }
  }
}

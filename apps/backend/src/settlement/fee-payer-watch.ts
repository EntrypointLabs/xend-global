import { Inject, Injectable, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MailModule } from '../mail/mail.module';
import { MAILER, type Mailer } from '../mail/mail.interface';
import { SOLANA_RPC, type SolanaRpc } from '../solana/solana-rpc.interface';
import { SolanaModule } from '../solana/solana.module';
import {
  SETTLEMENT_AUTHORITY_SIGNER,
  type SettlementAuthoritySigner,
} from './settlement-authority.interface';
import { SettlementAuthorityModule } from './settlement-authority.module';

const LAMPORTS_PER_SOL = 1_000_000_000;
// About 24 first sends to new addresses at 0.00204 SOL of token-account rent each.
const DEFAULT_MIN_SOL = 0.05;
const ALERT_EVERY_MS = 6 * 60 * 60_000;

/**
 * A refusal caused by the fee payer itself running dry. Account 0 of every
 * Spend is the settlement authority, so a rent or lamports shortfall on it is
 * ours to fix, not the Consumer's.
 */
export function isFeePayerShortfall(error: unknown): boolean {
  const text =
    error instanceof Error
      ? `${error.message} ${JSON.stringify((error as { logs?: unknown }).logs ?? '')}`
      : String(error);
  return (
    /account \(0\) with insufficient funds for rent/i.test(text) ||
    /insufficient funds for fee/i.test(text) ||
    /Attempt to debit an account but found no record of a prior credit/i.test(
      text,
    )
  );
}

/**
 * Watches the SOL that pays for every Spend, including the rent for each new
 * token account a send opens. Every bank send opens one at a fresh partner
 * address, so this drains steadily and, once short, every such send is refused.
 */
@Injectable()
export class FeePayerWatchService {
  private readonly logger = new Logger(FeePayerWatchService.name);
  private lastAlertAt = 0;
  private low = false;

  constructor(
    private readonly config: ConfigService,
    @Inject(SOLANA_RPC) private readonly solana: SolanaRpc,
    @Inject(SETTLEMENT_AUTHORITY_SIGNER)
    private readonly authority: SettlementAuthoritySigner,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  private get minLamports(): bigint {
    const sol = Number(
      this.config.get<string>('FEE_PAYER_MIN_SOL') ?? DEFAULT_MIN_SOL,
    );
    const safe = Number.isFinite(sol) && sol > 0 ? sol : DEFAULT_MIN_SOL;
    return BigInt(Math.round(safe * LAMPORTS_PER_SOL));
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async tick(): Promise<void> {
    await this.check();
  }

  /** Called when a send was just refused for want of fee-payer SOL. */
  async onShortfall(): Promise<void> {
    this.lastAlertAt = 0;
    await this.check();
  }

  async check(): Promise<void> {
    const address = this.authority.address;
    let lamports: bigint;
    try {
      lamports = await this.solana.getSolBalance(address);
    } catch (err) {
      this.logger.warn('fee_payer.balance_unreadable', err);
      return;
    }
    const sol = Number(lamports) / LAMPORTS_PER_SOL;
    if (lamports >= this.minLamports) {
      if (this.low) this.logger.log(`fee_payer.recovered balance_sol=${sol}`);
      this.low = false;
      return;
    }
    this.low = true;
    this.logger.error(
      `fee_payer.low address=${address} balance_sol=${sol} min_sol=${Number(this.minLamports) / LAMPORTS_PER_SOL}`,
    );
    if (Date.now() - this.lastAlertAt < ALERT_EVERY_MS) return;
    this.lastAlertAt = Date.now();
    await this.alert(address, sol);
  }

  private async alert(address: string, sol: number): Promise<void> {
    const to =
      this.config.get<string>('OPS_ALERT_EMAIL') ||
      this.config.get<string>('SUPPORT_INBOX_EMAIL');
    if (!to) return;
    try {
      await this.mailer.send({
        to,
        subject: `Fee wallet is low: ${sol.toFixed(4)} SOL`,
        text: [
          `The wallet that pays network fees and new token-account rent for every send has ${sol} SOL left.`,
          '',
          `Address: ${address}`,
          '',
          'Below about 0.00204 SOL, every bank send and every first send to a new wallet is refused. Top it up with SOL.',
        ].join('\n'),
      });
    } catch (err) {
      this.lastAlertAt = 0;
      this.logger.warn('fee_payer.alert_failed', err);
    }
  }
}

@Module({
  imports: [SolanaModule, SettlementAuthorityModule, MailModule],
  providers: [FeePayerWatchService],
  exports: [FeePayerWatchService],
})
export class FeePayerWatchModule {}

import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { inArray } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { smartAccounts } from '../db/schema';
import { SOLANA_RPC } from '../solana/solana-rpc.interface';
import type { SolanaRpc } from '../solana/solana-rpc.interface';
import { EventParser } from './event-parser';
import type { HeliusWebhookBody } from './event-parser';
import { ReconcilerService } from './reconciler.service';
import { TailerService } from './tailer.service';

/**
 * Kill-switch for the dropped-webhook devnet scenario (Phase 2 verify
 * scenario c). When `ACTIVITY_WEBHOOK_KILLSWITCH=1`, the receiver
 * acknowledges deliveries with `{ killSwitched: true, processed: 0 }`
 * without parsing, looking up wallets, or writing rows. Reconciler
 * remains the only confirmation path until the env var is cleared.
 *
 * Kept as an env var (not a feature-flag table) for a one-line
 * operator toggle — `unset ACTIVITY_WEBHOOK_KILLSWITCH && restart`.
 */
function killSwitchActive(): boolean {
  return process.env.ACTIVITY_WEBHOOK_KILLSWITCH === '1';
}

/**
 * WebhookController — POST /webhooks/helius.
 *
 * Flow:
 *   1. Verify HMAC via SolanaRpc.verifyWebhookSignature(rawBody, sig).
 *      Bad sig → 401 INVALID_WEBHOOK_SIGNATURE (the adapter throws
 *      HttpException with that code; Nest serializes it).
 *   2. EventParser.parseDecoded(body) → ConfirmedTransferEvent[].
 *   3. For each event: match fromAddress OR toAddress against owned
 *      `smart_accounts.wallet_address`. Skip silently if neither.
 *   4. For matches: TailerService.upsertConfirmedTransfer.
 *   5. Return 200 with `{ processed, skipped }`.
 *
 * Hot path metrics (structured logs the verifier can grep):
 *   - `tailer.webhook.received` once per delivery (count of events).
 *   - `tailer.webhook.latency_ms` once per matched event (block →
 *     row update).
 *
 * Helius retries on non-2xx. The receiver must therefore be
 * idempotent under retry; the TailerService's ON CONFLICT clause
 * provides that.
 */
@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly db: DbService,
    private readonly tailer: TailerService,
    private readonly parser: EventParser,
    @Inject(SOLANA_RPC) private readonly solana: SolanaRpc,
    private readonly reconciler: ReconcilerService,
  ) {}

  @Post('helius')
  @HttpCode(200)
  async receive(
    @Req() reqUnknown: unknown,
    @Headers('authorization') authHeader: string,
    @Headers('x-helius-signature') heliusSig: string,
    @Body() rawBodyParsed: unknown,
  ): Promise<{ processed: number; skipped: number; killSwitched?: boolean }> {
    const req = reqUnknown as Request;
    const body = rawBodyParsed as HeliusWebhookBody;
    if (killSwitchActive()) {
      this.logger.warn(
        `tailer.webhook.received killSwitched events=${Array.isArray(body) ? body.length : 0}`,
      );
      return {
        processed: 0,
        skipped: Array.isArray(body) ? body.length : 0,
        killSwitched: true,
      };
    }

    // Helius sends the shared secret in the Authorization header
    // (per their webhook docs). Some configurations also send
    // x-helius-signature; accept either, prefer Authorization.
    const signature = authHeader ?? heliusSig ?? '';
    const rawBody: Buffer =
      (req as Request & { rawBody?: Buffer }).rawBody ??
      Buffer.from(JSON.stringify(body), 'utf-8');

    // verifyWebhookSignature throws HttpException(401) on mismatch.
    // Nest's exception filter serializes that; no DB writes happen
    // before this line.
    this.solana.verifyWebhookSignature(rawBody, signature);

    const events = this.parser.parseDecoded(body);
    this.logger.log(
      `tailer.webhook.received events=${events.length} deliveryCount=${Array.isArray(body) ? body.length : 0}`,
    );

    if (events.length === 0) return { processed: 0, skipped: 0 };

    // Look up our wallets that match any address in this delivery.
    // One DB round-trip with IN(...) — cheap even for large batches.
    const candidateAddrs = new Set<string>();
    for (const evt of events) {
      candidateAddrs.add(evt.fromAddress);
      candidateAddrs.add(evt.toAddress);
    }
    const ourAccounts = await this.db.client
      .select({
        id: smartAccounts.id,
        walletAddress: smartAccounts.walletAddress,
      })
      .from(smartAccounts)
      .where(inArray(smartAccounts.walletAddress, [...candidateAddrs]));

    const addrToAccount = new Map(
      ourAccounts.map((a) => [a.walletAddress, a.id]),
    );

    let processed = 0;
    let skipped = 0;
    for (const evt of events) {
      // Prefer SEND side when the wallet is ours as sender (matches
      // the prepare/submit path's direction assignment).
      let ownerAddr: string | undefined;
      if (addrToAccount.has(evt.fromAddress)) ownerAddr = evt.fromAddress;
      else if (addrToAccount.has(evt.toAddress)) ownerAddr = evt.toAddress;
      if (!ownerAddr) {
        skipped++;
        continue;
      }
      const smartAccountId = addrToAccount.get(ownerAddr)!;
      try {
        const dir = await this.tailer.upsertConfirmedTransfer(
          evt,
          smartAccountId,
          ownerAddr,
        );
        const latency = Date.now() - evt.confirmedAt.getTime();
        this.logger.log(
          `tailer.webhook.latency_ms sig=${evt.signature} direction=${dir} latency_ms=${latency}`,
        );
        // Bump the denominator for the rolling
        // tailer.reconcile.percent_of_confirmations metric so the
        // reconciler's % calculation reflects webhook-led finalizations.
        this.reconciler.recordWebhookFinalization();
        processed++;
      } catch (err) {
        // Per-event errors should not poison the whole batch; log and
        // continue so the rest of the delivery succeeds.
        this.logger.error(
          `Failed to upsert transfer sig=${evt.signature}: ${(err as Error).message}`,
          err,
        );
        skipped++;
      }
    }

    return { processed, skipped };
  }
}

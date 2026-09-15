import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { eq, inArray } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { InboundWebhookDedupe } from '../db/inbound-webhook-dedupe';
import { smartAccounts, squadsAccounts } from '../db/schema';
import { SOLANA_RPC } from '../solana/solana-rpc.interface';
import type { SolanaRpc } from '../solana/solana-rpc.interface';
import { EventParser } from './event-parser';
import type { HeliusWebhookBody } from './event-parser';
import { ReconcilerService } from './reconciler.service';
import { TailerService } from './tailer.service';

/**
 * POST /webhooks/helius.
 *
 * Flow:
 *   1. Verify HMAC via SolanaRpc.verifyWebhookSignature(rawBody, sig).
 *      Bad sig → 401 INVALID_WEBHOOK_SIGNATURE.
 *   2. EventParser.parseDecoded(body) → ConfirmedTransferEvent[].
 *   3. For each event: match fromAddress OR toAddress against owned
 *      `smart_accounts.wallet_address`. Skip silently if neither.
 *   4. For matches: TailerService.upsertConfirmedTransfer.
 *   5. Return 200 with `{ processed, skipped }`.
 *
 * Helius retries on non-2xx, so the receiver must be idempotent under
 * retry; the TailerService's ON CONFLICT clause provides that. If any
 * owned-wallet event fails to persist we must NOT acknowledge (200):
 * an inbound RECEIVE has no PENDING row for the reconciler to recover,
 * so a dropped delivery is permanent data loss. We throw to return 500
 * and let Helius redeliver the whole batch — the succeeded events are
 * collapsed by ON CONFLICT on redelivery.
 */
const PROVIDER = 'helius';

@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly db: DbService,
    private readonly tailer: TailerService,
    private readonly parser: EventParser,
    @Inject(SOLANA_RPC) private readonly solana: SolanaRpc,
    private readonly reconciler: ReconcilerService,
    private readonly config: ConfigService,
    private readonly dedupe: InboundWebhookDedupe,
  ) {}

  /**
   * ACTIVITY_WEBHOOK_KILLSWITCH: acknowledge deliveries with
   * `{ killSwitched: true, processed: 0 }` without parsing, looking up
   * wallets, or writing rows. The reconciler remains the only confirmation
   * path until the flag is cleared. An env var (not a feature-flag table)
   * for a one-line operator toggle.
   */
  private killSwitchActive(): boolean {
    return this.config.get<boolean>('ACTIVITY_WEBHOOK_KILLSWITCH') === true;
  }

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
    if (this.killSwitchActive()) {
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

    // Throws HttpException(401) on mismatch; no DB writes happen before
    // this line.
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
    const addrs = [...candidateAddrs];
    // Vaults as well as Privy wallets. The vault is the address a Consumer is
    // told to receive at, so a deposit that touches only the vault would be
    // dismissed as somebody else's traffic. Both resolve to the owner's
    // smart_accounts row, which is what transfers.smart_account_id references.
    const [privyOwned, vaultOwned] = await Promise.all([
      this.db.client
        .select({
          id: smartAccounts.id,
          walletAddress: smartAccounts.walletAddress,
        })
        .from(smartAccounts)
        .where(inArray(smartAccounts.walletAddress, addrs)),
      this.db.client
        .select({
          id: smartAccounts.id,
          walletAddress: squadsAccounts.vaultAddress,
        })
        .from(squadsAccounts)
        .innerJoin(
          smartAccounts,
          eq(smartAccounts.userId, squadsAccounts.userId),
        )
        .where(inArray(squadsAccounts.vaultAddress, addrs)),
    ]);

    const addrToAccount = new Map(
      [...privyOwned, ...vaultOwned].map((a) => [a.walletAddress, a.id]),
    );

    let processed = 0;
    let skipped = 0;
    let failed = 0;
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
      // One transaction can carry several legs, so the leg is part of the id.
      const eventId = `${evt.signature}:${evt.legIndex}`;
      if (!(await this.dedupe.claim(PROVIDER, eventId))) {
        this.logger.warn(`tailer.webhook.replayed sig=${evt.signature}`);
        skipped++;
        continue;
      }
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
        this.reconciler.recordWebhookFinalization();
        processed++;
      } catch (err) {
        // Persisting an owned event failed. Do NOT swallow this: an
        // inbound RECEIVE has no PENDING row the reconciler can recover
        // from, so acknowledging (200) would lose it permanently. Record
        // the failure and force a non-2xx below so Helius redelivers.
        this.logger.error(
          `Failed to upsert transfer sig=${evt.signature}: ${(err as Error).message}`,
          err,
        );
        await this.dedupe.release(PROVIDER, eventId);
        failed++;
      }
    }

    if (failed > 0) {
      throw new HttpException(
        `Failed to persist ${failed} owned webhook event(s); retry requested`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return { processed, skipped };
  }
}

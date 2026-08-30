import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { z } from 'zod';
import {
  CapacityExceededError,
  InsufficientBalanceError,
} from '../capability/capability.errors';
import { PaymentAuthorizationService } from '../capability/payment-authorization.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DbService } from '../db/db.service';
import { merchants } from '../db/schema';
import { SettlementService } from '../settlement/settlement.service';
import { PaymentIntentService } from './payment-intent.service';
import {
  AttemptInFlightError,
  IntentExpiredError,
  IntentNotFoundError,
  IntentStateConflictError,
} from './payment.errors';

interface AuthenticatedRequest extends Request {
  user: { userId: string; walletAddress: string };
}

const SubmitSchema = z.object({ signedTxBase64: z.string().min(1) });
type SubmitBody = z.infer<typeof SubmitSchema>;

export interface PendingPaymentView {
  reference: string;
  merchantDisplayName: string;
  displayCurrency: string;
  displayAmountMinor: string;
  /** When Checkout handed this over, which is when the Consumer was asked. */
  deferredAt: string;
  expiresAt: string;
}

/**
 * Payments a Consumer has to finish on their phone.
 *
 * Checkout can only reach the primary signer. A Payment above the band that
 * signer carries alone needs the approval signer too, which lives on this
 * device and nowhere else, so Checkout refuses it and the Payment waits here.
 *
 * The Consumer sees it in Activity, opens it, and the phone signs with both.
 * That is one transaction rather than a signature collected at the checkout and
 * a second added later: both Spend routes are synchronous and bound to a single
 * blockhash, so a half-signed Payment would be dead long before anyone reached
 * their phone.
 */
@Controller('payments/pending')
@UseGuards(AuthGuard('jwt'))
export class PendingPaymentController {
  constructor(
    private readonly intents: PaymentIntentService,
    private readonly auth: PaymentAuthorizationService,
    private readonly settlement: SettlementService,
    private readonly db: DbService,
  ) {}

  @Get()
  async list(
    @Req() req: AuthenticatedRequest,
  ): Promise<{ payments: PendingPaymentView[] }> {
    const rows = await this.intents.listAwaitingApproval(req.user.userId);
    const payments = await Promise.all(
      rows.map(async (intent) => {
        const [merchant] = await this.db.client
          .select({ displayName: merchants.displayName })
          .from(merchants)
          .where(eq(merchants.id, intent.merchantId))
          .limit(1);
        return {
          reference: intent.id,
          merchantDisplayName: merchant?.displayName ?? 'Merchant',
          displayCurrency: intent.displayCurrency,
          displayAmountMinor: intent.displayAmountMinor,
          deferredAt: (
            intent.approvalDeferredAt ?? intent.createdAt
          ).toISOString(),
          expiresAt: intent.expiresAt.toISOString(),
        };
      }),
    );
    return { payments };
  }

  /**
   * Builds the Spend and authorizes the Payment, in that order and for the same
   * reason Checkout does it that way: a Payment the Account cannot carry must
   * be refused while the intent is untouched rather than after capacity has
   * been spent on it.
   */
  @Post(':reference/prepare')
  async prepare(
    @Req() req: AuthenticatedRequest,
    @Param('reference') reference: string,
  ): Promise<{ unsignedTxBase64: string; needsApprovalSignature: boolean }> {
    try {
      await this.assertOwned(req.user.userId, reference);
      const built = await this.settlement.buildSettlement(
        reference,
        req.user.userId,
      );
      await this.auth.authorize({
        intentId: reference,
        consumerId: req.user.userId,
      });
      await this.settlement.pinSettlement(reference, built);
      return {
        unsignedTxBase64: built.unsignedTxBase64,
        needsApprovalSignature: built.needsApprovalSignature,
      };
    } catch (err) {
      this.mapServiceError(err);
    }
  }

  @Post(':reference/submit')
  async submit(
    @Req() req: AuthenticatedRequest,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(SubmitSchema)) body: SubmitBody,
  ): Promise<{ signature: string }> {
    try {
      await this.assertOwned(req.user.userId, reference);
      const { signature } = await this.settlement.submitSettlement(
        reference,
        body.signedTxBase64,
      );
      return { signature };
    } catch (err) {
      this.mapServiceError(err);
    }
  }

  /**
   * A Payment belongs to whoever Checkout resolved when it deferred it. Another
   * Consumer asking for it is answered as though it does not exist, so this
   * never confirms that somebody else's Payment is real.
   */
  private async assertOwned(userId: string, reference: string): Promise<void> {
    const intent = await this.intents.findById(reference);
    if (intent.consumerId !== userId || !intent.approvalDeferredAt) {
      throw new IntentNotFoundError(`intent ${reference} not found`);
    }
  }

  private mapServiceError(err: unknown): never {
    if (err instanceof IntentNotFoundError) {
      throw new HttpException(
        { code: err.code, message: err.message },
        HttpStatus.NOT_FOUND,
      );
    }
    if (err instanceof IntentExpiredError) {
      throw new HttpException(
        { code: err.code, message: err.message },
        HttpStatus.GONE,
      );
    }
    if (
      err instanceof IntentStateConflictError ||
      err instanceof AttemptInFlightError ||
      err instanceof CapacityExceededError ||
      err instanceof InsufficientBalanceError
    ) {
      throw new HttpException(
        { code: err.code, message: err.message },
        HttpStatus.CONFLICT,
      );
    }
    throw err as Error;
  }
}

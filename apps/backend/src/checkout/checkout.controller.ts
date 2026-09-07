import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DbService } from '../db/db.service';
import { merchants, paymentIntents } from '../db/schema';
import { PaymentIntentService } from '../payment/payment-intent.service';
import {
  AttemptInFlightError,
  IntentExpiredError,
  IntentNotFoundError,
  IntentStateConflictError,
} from '../payment/payment.errors';
import { PaymentAuthorizationService } from '../capability/payment-authorization.service';
import { CapacityService } from '../capability/capacity.service';
import { IdentityService } from '../capability/identity.service';
import {
  CapacityExceededError,
  InsufficientBalanceError,
  LiveIntentOnSimulatedPathError,
  UnknownConsumerError,
} from '../capability/capability.errors';
import { SessionService } from '../session/session.service';
import {
  SessionInvalidError,
  SessionVelocityExceededError,
} from '../session/session.errors';
import { SettlementConfirmationService } from '../settlement/settlement-confirmation.service';
import { SettlementService } from '../settlement/settlement.service';
import { NotificationsService } from '../notifications/notifications.service';
import { formatDisplayMoney } from '../fx/currency';
import { SettlementAccountNotProvisionedError } from '../settlement/settlement.errors';
import { signReturnUrl } from './return-url';
import {
  ApprovalRequiredError,
  PaymentProcessingError,
} from './checkout.errors';
import {
  AuthorizeBodySchema,
  SettleBodySchema,
  type AuthorizeBody,
  type AuthorizeResponse,
  type IntentSummary,
  type SettleBody,
  type SettleResponse,
} from './dtos';

type IntentRow = typeof paymentIntents.$inferSelect;
type MerchantRow = typeof merchants.$inferSelect;

const AUTHORIZE_WAIT_MS = 15_000;
const AUTHORIZE_POLL_MS = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/**
 * The consumer-facing Checkout HTTP surface (Phase 5's popup consumes it).
 * Access control is the high-entropy pi_ reference plus session-cookie /
 * provider-token verification on the write path; Phase 1's CORS exact-origin
 * allowlist and correlation middleware apply. No guard class here.
 */
@Controller('checkout')
export class CheckoutController {
  private readonly logger = new Logger(CheckoutController.name);

  // Test-tunable so a spec can exercise the blocking wait without real delays.
  authorizeWaitMs = AUTHORIZE_WAIT_MS;
  authorizePollMs = AUTHORIZE_POLL_MS;

  constructor(
    private readonly intents: PaymentIntentService,
    private readonly auth: PaymentAuthorizationService,
    private readonly capacity: CapacityService,
    private readonly identity: IdentityService,
    private readonly sessions: SessionService,
    private readonly db: DbService,
    private readonly config: ConfigService,
    private readonly settlement: SettlementService,
    private readonly notifications: NotificationsService,
    // The sandbox settlement for test-mode intents, and the development
    // short-circuit for live ones (gated on NODE_ENV==='development').
    private readonly confirmation: SettlementConfirmationService,
  ) {}

  @Get('intents/:reference')
  async getSummary(
    @Req() req: Request,
    @Param('reference') reference: string,
    @Query('opener') opener?: string,
  ): Promise<IntentSummary> {
    try {
      const intent = await this.intents.findById(reference);
      const [merchant] = await this.db.client
        .select()
        .from(merchants)
        .where(eq(merchants.id, intent.merchantId))
        .limit(1);
      if (!merchant) {
        throw new IntentNotFoundError(`intent ${reference} not found`);
      }

      const merchantOrigin = await this.resolveMerchantOrigin(
        intent,
        merchant,
        opener,
      );

      const cookieName = this.config.getOrThrow<string>(
        'CHECKOUT_SESSION_COOKIE',
      );
      const cookieToken = readCookie(req, cookieName);
      const sessionRecognized = cookieToken
        ? await this.sessions.peek(cookieToken, intent.merchantId)
        : false;

      const summary: IntentSummary = {
        reference: intent.id,
        status: intent.status,
        merchantDisplayName: merchant.displayName,
        displayCurrency: intent.displayCurrency,
        displayAmountMinor: intent.displayAmountMinor,
        merchantOrigin,
        sessionRecognized,
        expiresAt: intent.expiresAt.toISOString(),
        livemode: intent.mode === 'live',
      };

      // Redirect-mode cancel happens BEFORE any authorize call, so the signed
      // cancel target rides on the summary rather than an authorize response.
      if (intent.cancelUrl) {
        const secret = this.config.getOrThrow<string>(
          'CHECKOUT_RETURN_URL_SECRET',
        );
        summary.cancelUrl = signReturnUrl(
          intent.cancelUrl,
          intent.id,
          'canceled',
          secret,
        );
      }

      return summary;
    } catch (err) {
      this.mapServiceError(err);
    }
  }

  @Post('authorize')
  async authorize(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodValidationPipe(AuthorizeBodySchema)) body: AuthorizeBody,
  ): Promise<AuthorizeResponse> {
    const { reference } = body;
    try {
      const intent = await this.intents.findById(reference);
      const cookieName = this.config.getOrThrow<string>(
        'CHECKOUT_SESSION_COOKIE',
      );
      const cookieToken = readCookie(req, cookieName);

      // A test-mode intent settles through the sandbox: the Consumer is still
      // a verified identity, but needs no Account, no capacity and no chain.
      const simulated = intent.mode === 'test';

      // Who is paying, resolved before anything is written. The ceremony path
      // reads it from the verified provider token; the one-tap path reads it
      // from the Session, whose validation is read-only and repeated inside
      // authorize below.
      let consumerId: string;
      if (body.providerToken) {
        const profile = await this.identity.resolveByProviderToken(
          body.providerToken,
          { withoutAccount: simulated },
        );
        consumerId = profile.consumerId;
      } else {
        if (!cookieToken) {
          throw new SessionInvalidError('no session cookie or provider token');
        }
        const session = await this.sessions.validate(
          cookieToken,
          intent.merchantId,
        );
        consumerId = session.consumerId;
      }

      if (simulated) {
        await this.auth.authorizeSimulated({ intentId: reference, consumerId });
        if (body.providerToken) {
          const { token } = await this.sessions.issue({
            consumerId,
            merchantId: intent.merchantId,
            issuingIntentId: reference,
          });
          this.setSessionCookie(res, cookieName, token);
        }
        await this.confirmation.settleTestMode(reference);
        return await this.terminalResponse(reference);
      }

      // Capacity first, and read-only: it decides whether this Payment can
      // complete at all. Handing it to the app before asking would send the
      // Consumer to their phone for a Payment their tier refuses the moment
      // they get there. Nothing is consumed here; authorize below runs the
      // same check again and is what actually spends the allowance.
      await this.capacity.checkCapacity(consumerId, intent.usdcSettlementRaw);

      // Then build the Spend, still BEFORE the intent moves, so an Account that
      // cannot carry this Payment on one signature is refused with nothing
      // consumed: no capacity spent, no Session issued, the intent still
      // payable from the app. Skipped only by the development short-circuit
      // below.
      const devSettle =
        this.config.get<string>('NODE_ENV') === 'development' &&
        this.config.get<boolean>('CHECKOUT_DEV_FORCE_SETTLE') !== false;
      const built = devSettle
        ? null
        : await this.settlement.buildSettlement(reference, consumerId);
      if (built?.needsApprovalSignature) {
        // Record who is paying before refusing. The intent stays payable and
        // nothing is authorized, but without this the Payment is unfindable
        // from the app: an intent only learns its Consumer when it is
        // authorized, and this one deliberately never gets that far.
        await this.intents.deferToApproval(reference, consumerId);

        // Then reach for the phone. The popup says to open the app, but the
        // Consumer may already have closed it, and the banner and the Activity
        // row only exist once they look. Detached: the Payment is correctly
        // refused whether or not a notice gets out, and somebody at a till is
        // not kept waiting on a push provider.
        const merchant = await this.merchantName(intent.merchantId);
        void this.notifications.notifyPaymentNeedsApproval(consumerId, {
          merchantName: merchant,
          amount: formatDisplayMoney(
            intent.displayCurrency,
            intent.displayAmountMinor,
          ),
        });

        throw new ApprovalRequiredError(
          `intent ${reference} is above the one-signature band and has to be approved from the Xend app`,
        );
      }

      if (body.providerToken) {
        // First-payment path: authorize, issue a Session, and set the fresh raw
        // token as the HttpOnly cookie (the one place the raw token crosses to
        // a cookie).
        await this.auth.authorize({ intentId: reference, consumerId });
        const { token } = await this.sessions.issue({
          consumerId,
          merchantId: intent.merchantId,
          issuingIntentId: reference,
        });
        this.setSessionCookie(res, cookieName, token);
      } else {
        // One-tap repeat path: authorize via the session cookie and rotate the
        // HttpOnly cookie in place.
        const result = await this.auth.authorize({
          intentId: reference,
          sessionToken: cookieToken,
        });
        if (result.rotatedSessionToken) {
          this.setSessionCookie(res, cookieName, result.rotatedSessionToken);
        }
      }

      if (built) {
        // The Consumer signs at the popup and hands the bytes to /settle. The
        // pin is what makes that safe to complete with the fee payer.
        await this.settlement.pinSettlement(reference, built);
        return {
          status: 'needs_signature',
          unsignedTxBase64: built.unsignedTxBase64,
          signerAddress: built.signerAddress,
        };
      }

      // TEST ONLY, never production. A live-mode intent in local development
      // with CHECKOUT_DEV_FORCE_SETTLE on: there is no funded settlement
      // authority, so no Spend can be broadcast and waiting for one would only
      // time out (PAYMENT_PROCESSING). Force the authorized intent to a
      // terminal SUCCEEDED (fake signature, same payment.succeeded event).
      // Hard-gated on NODE_ENV==='development'.
      await this.confirmation.devForceSettleSucceeded(reference);
      return this.terminalResponse(reference);
    } catch (err) {
      this.mapServiceError(err);
    }
  }

  /**
   * The second half of a Payment: the Consumer signed the Spend, the fee payer
   * completes and broadcasts it, and this blocks until the chain says which way
   * it went.
   */
  @Post('settle')
  async settle(
    @Body(new ZodValidationPipe(SettleBodySchema)) body: SettleBody,
  ): Promise<SettleResponse> {
    try {
      await this.settlement.submitSettlement(
        body.reference,
        body.signedTxBase64,
      );
      return await this.terminalResponse(body.reference);
    } catch (err) {
      this.mapServiceError(err);
    }
  }

  /** Waits for the chain and shapes the signed return URLs onto the outcome. */
  private async terminalResponse(reference: string): Promise<SettleResponse> {
    const terminal = await this.pollUntilTerminal(reference);
    const status = terminal.status as 'succeeded' | 'failed';
    const secret = this.config.getOrThrow<string>('CHECKOUT_RETURN_URL_SECRET');
    const response: SettleResponse = { status };
    if (terminal.returnUrl) {
      response.redirectUrl = signReturnUrl(
        terminal.returnUrl,
        reference,
        status,
        secret,
      );
    }
    if (terminal.cancelUrl) {
      response.cancelUrl = signReturnUrl(
        terminal.cancelUrl,
        reference,
        'canceled',
        secret,
      );
    }
    return response;
  }

  /**
   * Where the popup posts the result. The page that opened the checkout names
   * itself on the launch URL; it is honoured only if it is one of the
   * Merchant's registered origins, and then remembered on the intent so a
   * later load (the redirect return, a reload) still answers with it. With
   * nothing usable the first registered origin stands, as it always has.
   */
  private async resolveMerchantOrigin(
    intent: IntentRow,
    merchant: MerchantRow,
    requested: string | undefined,
  ): Promise<string | null> {
    const allowed = merchant.allowedOrigins ?? [];
    if (requested && allowed.includes(requested)) {
      if (intent.openerOrigin !== requested) {
        await this.db.client
          .update(paymentIntents)
          .set({ openerOrigin: requested, updatedAt: new Date() })
          .where(eq(paymentIntents.id, intent.id));
      }
      return requested;
    }
    if (requested) {
      this.logger.warn(
        `checkout.opener_not_allowed intent_id=${intent.id} merchant_id=${merchant.id}`,
      );
    }
    if (intent.openerOrigin && allowed.includes(intent.openerOrigin)) {
      return intent.openerOrigin;
    }
    return allowed[0] ?? null;
  }

  /** The Merchant as the Consumer knows them, never an id. */
  private async merchantName(merchantId: string): Promise<string> {
    const [merchant] = await this.db.client
      .select({ displayName: merchants.displayName })
      .from(merchants)
      .where(eq(merchants.id, merchantId))
      .limit(1);
    return merchant?.displayName ?? 'A merchant';
  }

  private setSessionCookie(res: Response, name: string, token: string): void {
    const ttlDays = this.config.getOrThrow<number>('SESSION_ABSOLUTE_TTL_DAYS');
    res.cookie(name, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: ttlDays * 24 * 60 * 60 * 1000,
      // Host-only: no Domain attribute. Same-origin /api on pay.xend.global
      // keeps this a first-party credential unreadable to merchant-page JS.
    });
  }

  private async pollUntilTerminal(reference: string): Promise<IntentRow> {
    const start = Date.now();
    for (;;) {
      const current = await this.intents.findById(reference);
      if (current.status === 'succeeded' || current.status === 'failed') {
        return current;
      }
      if (Date.now() - start >= this.authorizeWaitMs) {
        throw new PaymentProcessingError(
          'settlement outcome did not arrive inside the authorize window',
        );
      }
      await sleep(this.authorizePollMs);
    }
  }

  private mapServiceError(err: unknown): never {
    if (
      err instanceof SessionInvalidError ||
      err instanceof UnknownConsumerError
    ) {
      throw new HttpException(
        { code: err.code, message: err.message },
        HttpStatus.UNAUTHORIZED,
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
      err instanceof LiveIntentOnSimulatedPathError ||
      err instanceof CapacityExceededError ||
      err instanceof SessionVelocityExceededError ||
      err instanceof InsufficientBalanceError ||
      err instanceof ApprovalRequiredError ||
      err instanceof SettlementAccountNotProvisionedError
    ) {
      throw new HttpException(
        { code: err.code, message: err.message },
        HttpStatus.CONFLICT,
      );
    }
    if (err instanceof IntentNotFoundError) {
      throw new HttpException(
        { code: err.code, message: err.message },
        HttpStatus.NOT_FOUND,
      );
    }
    if (err instanceof PaymentProcessingError) {
      throw new HttpException(
        { code: err.code, message: err.message },
        HttpStatus.BAD_GATEWAY,
      );
    }
    throw err as Error;
  }
}

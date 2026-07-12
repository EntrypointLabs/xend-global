import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
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
import { IdentityService } from '../capability/identity.service';
import {
  CapacityExceededError,
  InsufficientBalanceError,
  UnknownConsumerError,
} from '../capability/capability.errors';
import { SessionService } from '../session/session.service';
import {
  SessionInvalidError,
  SessionVelocityExceededError,
} from '../session/session.errors';
import { signReturnUrl } from './return-url';
import { PaymentProcessingError } from './checkout.errors';
import {
  AuthorizeBodySchema,
  type AuthorizeBody,
  type AuthorizeResponse,
  type IntentSummary,
} from './dtos';

type IntentRow = typeof paymentIntents.$inferSelect;

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
  // Test-tunable so a spec can exercise the blocking wait without real delays.
  authorizeWaitMs = AUTHORIZE_WAIT_MS;
  authorizePollMs = AUTHORIZE_POLL_MS;

  constructor(
    private readonly intents: PaymentIntentService,
    private readonly auth: PaymentAuthorizationService,
    private readonly identity: IdentityService,
    private readonly sessions: SessionService,
    private readonly db: DbService,
    private readonly config: ConfigService,
  ) {}

  @Get('intents/:reference')
  async getSummary(
    @Req() req: Request,
    @Param('reference') reference: string,
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

      const merchantOrigin =
        merchant.allowedOrigins && merchant.allowedOrigins.length > 0
          ? merchant.allowedOrigins[0]
          : null;

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
        ngnDisplayMinor: intent.ngnDisplayMinor,
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

      if (body.providerToken) {
        // First-payment path: resolve the Consumer, authorize, issue a Session,
        // and set the fresh raw token as the HttpOnly cookie (the one place
        // Phase 2's raw token crosses to a cookie).
        const profile = await this.identity.resolveByProviderToken(
          body.providerToken,
        );
        await this.auth.authorize({
          intentId: reference,
          consumerId: profile.consumerId,
        });
        const { token } = await this.sessions.issue({
          consumerId: profile.consumerId,
          merchantId: intent.merchantId,
          issuingIntentId: reference,
        });
        this.setSessionCookie(res, cookieName, token);
      } else {
        const cookieToken = readCookie(req, cookieName);
        if (!cookieToken) {
          throw new SessionInvalidError('no session cookie or provider token');
        }
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

      const terminal = await this.pollUntilTerminal(reference);
      const status = terminal.status as 'succeeded' | 'failed';
      const secret = this.config.getOrThrow<string>(
        'CHECKOUT_RETURN_URL_SECRET',
      );
      const response: AuthorizeResponse = { status };
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
    } catch (err) {
      this.mapServiceError(err);
    }
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
      err instanceof CapacityExceededError ||
      err instanceof SessionVelocityExceededError ||
      err instanceof InsufficientBalanceError
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

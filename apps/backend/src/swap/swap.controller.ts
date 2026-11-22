import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';

import { AccountCreationError } from '../account/account.errors';
import { ConsumerAuthGuard } from '../auth/consumer-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  SwapPrepareRequestSchema,
  SwapQuoteRequestSchema,
  SwapSubmitRequestSchema,
  type SwapPrepareRequest,
  type SwapQuoteRequest,
  type SwapSubmitRequest,
} from './dtos';
import {
  AccountNeedsUpdateError,
  NoSwapRouteError,
  SwapMismatchError,
  SwapQuoteExpiredError,
  SwapUnavailableError,
} from './swap.errors';
import { SwapService } from './swap.service';

interface AuthenticatedRequest extends Request {
  user: { userId: string };
}

/**
 * /swaps/quote, /swaps/prepare and /swaps/submit.
 *
 *   NoSwapRouteError        -> 422 NO_ROUTE
 *   SwapQuoteExpiredError   -> 410 QUOTE_EXPIRED
 *   AccountNeedsUpdateError -> 409 ACCOUNT_NEEDS_UPDATE
 *   SwapMismatchError       -> 400 SWAP_MISMATCH
 *   SwapUnavailableError    -> 503 SWAP_UNAVAILABLE
 */
@Controller('swaps')
@UseGuards(ConsumerAuthGuard)
export class SwapController {
  constructor(private readonly swaps: SwapService) {}

  @Post('quote')
  async quote(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(SwapQuoteRequestSchema)) dto: SwapQuoteRequest,
  ) {
    try {
      return await this.swaps.quote(req.user.userId, dto);
    } catch (err) {
      mapServiceError(err);
    }
  }

  @Post('prepare')
  async prepare(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(SwapPrepareRequestSchema))
    dto: SwapPrepareRequest,
  ) {
    try {
      return await this.swaps.prepare(req.user.userId, dto.quoteId);
    } catch (err) {
      mapServiceError(err);
    }
  }

  @Post('submit')
  async submit(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(SwapSubmitRequestSchema))
    dto: SwapSubmitRequest,
  ) {
    try {
      return await this.swaps.submit(req.user.userId, dto.signedTxBase64);
    } catch (err) {
      mapServiceError(err);
    }
  }
}

const STATUS = new Map<string, HttpStatus>([
  ['NO_ROUTE', HttpStatus.UNPROCESSABLE_ENTITY],
  ['QUOTE_EXPIRED', HttpStatus.GONE],
  ['ACCOUNT_NEEDS_UPDATE', HttpStatus.CONFLICT],
  ['SWAP_MISMATCH', HttpStatus.BAD_REQUEST],
  ['SWAP_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE],
]);

function mapServiceError(err: unknown): never {
  if (
    err instanceof NoSwapRouteError ||
    err instanceof SwapQuoteExpiredError ||
    err instanceof AccountNeedsUpdateError ||
    err instanceof SwapMismatchError ||
    err instanceof SwapUnavailableError
  ) {
    throw new HttpException(
      { code: err.code, message: err.message },
      STATUS.get(err.code)!,
    );
  }
  if (err instanceof AccountCreationError) {
    throw new HttpException(
      { code: 'ACCOUNT_NOT_READY', message: err.message },
      HttpStatus.CONFLICT,
    );
  }
  throw err;
}

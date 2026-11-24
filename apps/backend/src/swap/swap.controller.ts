import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Query,
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
  SwapPriceMovedError,
  SwapQuoteExpiredError,
  SwapUnavailableError,
} from './swap.errors';
import { SwapService } from './swap.service';
import {
  SWAP_TOKEN_CATEGORIES,
  SWAP_TOKEN_DIRECTORY,
} from './swap-tokens.interface';
import type { SwapTokenDirectory } from './swap-tokens.interface';

interface AuthenticatedRequest extends Request {
  user: { userId: string };
}

/**
 * /swaps/tokens, /swaps/quote, /swaps/prepare and /swaps/submit.
 *
 *   NoSwapRouteError        -> 422 NO_ROUTE
 *   SwapQuoteExpiredError   -> 410 QUOTE_EXPIRED
 *   SwapPriceMovedError     -> 409 PRICE_MOVED
 *   AccountNeedsUpdateError -> 409 ACCOUNT_NEEDS_UPDATE
 *   SwapMismatchError       -> 400 SWAP_MISMATCH
 *   SwapUnavailableError    -> 503 SWAP_UNAVAILABLE
 */
@Controller('swaps')
@UseGuards(ConsumerAuthGuard)
export class SwapController {
  constructor(
    private readonly swaps: SwapService,
    @Inject(SWAP_TOKEN_DIRECTORY) private readonly tokens: SwapTokenDirectory,
  ) {}

  /**
   * The assets offered in Swap: those matching `q`, or else the popular ones
   * in `category`, or else the everyday list.
   */
  @Get('tokens')
  async listTokens(
    @Query('q') q?: string,
    @Query('category') category?: string,
  ) {
    const query = typeof q === 'string' ? q.trim().slice(0, 64) : '';
    const shelf = SWAP_TOKEN_CATEGORIES.find((known) => known === category);
    try {
      return {
        tokens: query
          ? await this.tokens.search(query)
          : await this.tokens.popular(shelf),
      };
    } catch {
      throw new HttpException(
        { code: 'SWAP_UNAVAILABLE', message: 'Token search is unavailable' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

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
  ['PRICE_MOVED', HttpStatus.CONFLICT],
  ['ACCOUNT_NEEDS_UPDATE', HttpStatus.CONFLICT],
  ['SWAP_MISMATCH', HttpStatus.BAD_REQUEST],
  ['SWAP_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE],
]);

function mapServiceError(err: unknown): never {
  if (
    err instanceof NoSwapRouteError ||
    err instanceof SwapQuoteExpiredError ||
    err instanceof SwapPriceMovedError ||
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

import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { TransferService } from './transfer.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  ListTransfersQuerySchema,
  PrepareRequestSchema,
  SubmitRequestSchema,
  type ListTransfersQuery,
  type PrepareRequest,
  type SubmitRequest,
} from './dtos';
import {
  InvalidRecipientError,
  IntentExpiredError,
  RpcUnavailableError,
  UnsupportedMintError,
} from './transfer.errors';

interface AuthenticatedRequest extends Request {
  user: { userId: string; walletAddress: string };
}

/**
 * Transfer controller — exposes the Phase 1 prepare/submit/list
 * endpoints at /transfers/*. The legacy /transactions/* controller
 * stays mounted alongside until Phase 5 (mobile still uses it until
 * Phase 4 cutover).
 *
 * Error mapping per PLAN.md "Error codes":
 *   InvalidRecipientError -> 400 INVALID_RECIPIENT
 *   UnsupportedMintError  -> 400 UNSUPPORTED_MINT
 *   IntentExpiredError    -> 410 INTENT_EXPIRED
 *   RpcUnavailableError   -> 502 RPC_UNAVAILABLE
 *
 * Service-thrown HttpException (e.g. NotFoundException from missing
 * smart_account) passes through untouched.
 */
@Controller('transfers')
@UseGuards(AuthGuard('jwt'))
export class TransferController {
  constructor(private readonly transfer: TransferService) {}

  @Post('prepare')
  async prepare(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(PrepareRequestSchema)) dto: PrepareRequest,
  ) {
    try {
      return await this.transfer.prepare(req.user.userId, dto);
    } catch (err) {
      this.mapServiceError(err);
    }
  }

  @Post('submit')
  async submit(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(SubmitRequestSchema)) dto: SubmitRequest,
  ) {
    try {
      return await this.transfer.submit(req.user.userId, dto);
    } catch (err) {
      this.mapServiceError(err);
    }
  }

  @Get()
  async list(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(ListTransfersQuerySchema))
    query: ListTransfersQuery,
  ) {
    try {
      return await this.transfer.list(req.user.userId, query);
    } catch (err) {
      this.mapServiceError(err);
    }
  }

  /**
   * Re-throw unknown errors untouched so Nest's default exception
   * filter handles them. Known typed errors are translated to the
   * HTTP shape spec'd in PLAN.md.
   */
  private mapServiceError(err: unknown): never {
    if (err instanceof InvalidRecipientError) {
      throw new HttpException(
        { code: err.code, message: err.message },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (err instanceof UnsupportedMintError) {
      throw new HttpException(
        { code: err.code, message: err.message },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (err instanceof IntentExpiredError) {
      throw new HttpException(
        { code: err.code, message: err.message },
        HttpStatus.GONE,
      );
    }
    if (err instanceof RpcUnavailableError) {
      throw new HttpException(
        { code: err.code, message: err.message },
        HttpStatus.BAD_GATEWAY,
      );
    }
    throw err as Error;
  }
}

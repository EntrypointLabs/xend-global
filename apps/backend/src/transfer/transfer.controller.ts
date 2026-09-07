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
import { AllowEntry } from '../auth/allow-entry.decorator';
import { ConsumerAuthGuard } from '../auth/consumer-auth.guard';
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
  IntentMismatchError,
  PresenceProofInvalidError,
  PresenceProofRequiredError,
  RpcUnavailableError,
  UnsupportedMintError,
} from './transfer.errors';

interface AuthenticatedRequest extends Request {
  user: { userId: string; walletAddress: string };
}

/**
 * Exposes the prepare/submit/list endpoints at /transfers/*.
 *
 * Error mapping:
 *   InvalidRecipientError -> 400 INVALID_RECIPIENT
 *   UnsupportedMintError  -> 400 UNSUPPORTED_MINT
 *   IntentMismatchError   -> 400 INTENT_MISMATCH
 *   IntentExpiredError    -> 410 INTENT_EXPIRED
 *   PresenceProofRequired -> 428 PRESENCE_REQUIRED
 *   PresenceProofInvalid  -> 403 PRESENCE_INVALID
 *   RpcUnavailableError   -> 502 RPC_UNAVAILABLE
 *
 * Service-thrown HttpException (e.g. NotFoundException from missing
 * smart_account) passes through untouched.
 */
@Controller('transfers')
@UseGuards(ConsumerAuthGuard)
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
  @AllowEntry()
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
   * Re-throw unknown errors untouched so Nest's default exception filter
   * handles them. Known typed errors are translated to their HTTP shape.
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
    if (err instanceof IntentMismatchError) {
      throw new HttpException(
        { code: err.code, message: err.message },
        HttpStatus.BAD_REQUEST,
      );
    }
    // 428 rather than 400: nothing about the request is malformed, it is
    // missing a precondition the client can go and satisfy.
    if (err instanceof PresenceProofRequiredError) {
      throw new HttpException(
        { code: err.code, message: err.message },
        HttpStatus.PRECONDITION_REQUIRED,
      );
    }
    if (err instanceof PresenceProofInvalidError) {
      throw new HttpException(
        { code: err.code, message: err.message },
        HttpStatus.FORBIDDEN,
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

import {
  Body,
  Controller,
  Headers,
  HttpException,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SettlementProviderUnavailableError } from '../settlement/settlement.errors';
import { InternalGuard } from './internal.guard';
import { RefundService } from './refund.service';
import {
  CreateRefundBodySchema,
  type CreateRefundBody,
  type RefundObject,
} from './refund.dtos';
import {
  IdempotencyKeyReuseError,
  PaymentNotRefundableError,
  RefundAmountExceedsRefundableError,
  RefundNotFoundError,
  RefundNotSupportedError,
} from './merchant.errors';

/**
 * Ops-initiated refund surface (InternalGuard). The merchants.xend.global
 * portal's refund-approval screen is the fast-follow that calls the same
 * service. Not a merchant key, not the consumer JWT.
 */
@Controller('internal')
@UseGuards(InternalGuard)
export class RefundController {
  constructor(private readonly refunds: RefundService) {}

  @Post('refunds')
  async create(
    @Body(new ZodValidationPipe(CreateRefundBodySchema)) body: CreateRefundBody,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<RefundObject> {
    try {
      return await this.refunds.refund({
        paymentId: body.payment_id,
        amountUsdcRaw: body.amount_usdc_raw,
        reason: body.reason,
        idempotencyKey,
      });
    } catch (err) {
      this.mapServiceError(err);
    }
  }

  private mapServiceError(err: unknown): never {
    if (err instanceof RefundNotFoundError) {
      throw new HttpException(
        { code: err.code, message: err.message },
        HttpStatus.NOT_FOUND,
      );
    }
    if (err instanceof RefundAmountExceedsRefundableError) {
      throw new HttpException(
        { code: err.code, message: err.message },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (
      err instanceof RefundNotSupportedError ||
      err instanceof PaymentNotRefundableError ||
      err instanceof SettlementProviderUnavailableError ||
      err instanceof IdempotencyKeyReuseError
    ) {
      throw new HttpException(
        { code: err.code, message: err.message },
        HttpStatus.CONFLICT,
      );
    }
    throw err as Error;
  }
}

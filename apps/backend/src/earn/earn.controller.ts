import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AllowEntry } from '../auth/allow-entry.decorator';
import { ConsumerAuthGuard } from '../auth/consumer-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { EarnService, type EarnRequest } from './earn.service';
import { EARN_HISTORY_RANGES, type EarnHistoryRange } from './earn-history';
import type { Request } from 'express';
interface AuthenticatedRequest extends Request {
  user: { userId: string };
}
export const EarnQuoteRequestSchema = z
  .object({
    provider: z.enum(['kamino', 'jupiter']),
    action: z.enum(['deposit', 'redeem']),
    amountMinor: z.string().regex(/^[1-9]\d{0,19}$/),
    withdrawAll: z.boolean().optional(),
  })
  .strict();
export const EarnHistoryQuerySchema = z
  .object({
    provider: z.enum(['kamino', 'jupiter']),
    range: z.enum(EARN_HISTORY_RANGES).default('30d'),
  })
  .strict();
const prepareSchema = z.object({ quoteId: z.string().uuid() }).strict();
const submitSchema = z
  .object({ signedTxBase64: z.string().min(1).max(2000) })
  .strict();
@Controller('earn')
@UseGuards(ConsumerAuthGuard)
export class EarnController {
  constructor(private readonly earn: EarnService) {}
  @AllowEntry()
  @Get()
  catalog(@Req() req: AuthenticatedRequest) {
    return this.earn.catalog(req.user.userId);
  }
  @AllowEntry()
  @Get('history')
  history(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(EarnHistoryQuerySchema))
    query: { provider: 'kamino' | 'jupiter'; range: EarnHistoryRange },
  ) {
    return this.earn.history(req.user.userId, query.provider, query.range);
  }
  @Post('quote') quote(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(EarnQuoteRequestSchema)) dto: EarnRequest,
  ) {
    return this.earn.quote(req.user.userId, dto);
  }
  @Post('prepare') prepare(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(prepareSchema)) dto: { quoteId: string },
  ) {
    return this.earn.prepare(req.user.userId, dto.quoteId);
  }
  @Post('submit') submit(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(submitSchema)) dto: { signedTxBase64: string },
  ) {
    return this.earn.submit(req.user.userId, dto.signedTxBase64);
  }
}

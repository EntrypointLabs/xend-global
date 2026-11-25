import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ConsumerAuthGuard } from '../auth/consumer-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { EarnService, type EarnRequest } from './earn.service';
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
const prepareSchema = z.object({ quoteId: z.string().uuid() }).strict();
const submitSchema = z
  .object({ signedTxBase64: z.string().min(1).max(2000) })
  .strict();
@Controller('earn')
@UseGuards(ConsumerAuthGuard)
export class EarnController {
  constructor(private readonly earn: EarnService) {}
  @Get() catalog(@Req() req: AuthenticatedRequest) {
    return this.earn.catalog(req.user.userId);
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

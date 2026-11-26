import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { isAddress } from '@solana/kit';
import { z } from 'zod';
import { AllowEntry } from '../auth/allow-entry.decorator';
import { ConsumerAuthGuard } from '../auth/consumer-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  TOKEN_OVERVIEW_RANGES,
  TokenOverviewService,
  type TokenOverviewRange,
} from './token-overview.service';

export const MintParamSchema = z
  .string()
  .refine((value) => isAddress(value), { message: 'Invalid mint address' });

export const TokenOverviewQuerySchema = z
  .object({ range: z.enum(TOKEN_OVERVIEW_RANGES).default('1d') })
  .strict();

@Controller('tokens')
@UseGuards(ConsumerAuthGuard)
export class TokenOverviewController {
  constructor(private readonly tokens: TokenOverviewService) {}

  @AllowEntry()
  @Get(':mint/overview')
  overview(
    @Param('mint', new ZodValidationPipe(MintParamSchema)) mint: string,
    @Query(new ZodValidationPipe(TokenOverviewQuerySchema))
    query: { range: TokenOverviewRange },
  ) {
    return this.tokens.overview(mint, query.range);
  }
}

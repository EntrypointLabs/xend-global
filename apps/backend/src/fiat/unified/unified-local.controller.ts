import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UnifiedLocalGuard } from './unified-local.guard';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { UnifiedFiatService } from './unified.service';
import {
  UnifiedReceiveBody,
  UnifiedQuoteBody,
  UnifiedOrderBody,
  UnifiedAdvanceBody,
} from './unified.types';
import type {
  ReceiveInput,
  QuoteInput,
  OrderInput,
  AdvanceInput,
} from './unified.types';

@Controller('dev/fiat/unified')
@UseGuards(UnifiedLocalGuard)
export class UnifiedLocalController {
  constructor(private readonly unified: UnifiedFiatService) {}

  @Get()
  snapshot(
    @Req() req: { user: { userId: string } },
    @Query('displayCurrency') currency = 'USD',
  ) {
    if (currency !== 'USD' && currency !== 'NGN')
      throw new BadRequestException('Invalid display currency.');
    return this.unified.snapshot(req.user.userId, currency);
  }

  @Post('receive')
  receive(
    @Req() req: { user: { userId: string } },
    @Body(new ZodValidationPipe(UnifiedReceiveBody)) input: ReceiveInput,
  ) {
    return this.unified.receive(req.user.userId, input);
  }

  @Post('quotes')
  quote(
    @Req() req: { user: { userId: string } },
    @Body(new ZodValidationPipe(UnifiedQuoteBody)) input: QuoteInput,
  ) {
    return this.unified.quote(req.user.userId, input);
  }

  @Post('orders')
  order(
    @Req() req: { user: { userId: string } },
    @Body(new ZodValidationPipe(UnifiedOrderBody)) input: OrderInput,
  ) {
    return this.unified.order(req.user.userId, input);
  }

  @Post('orders/:id/advance')
  advance(
    @Req() req: { user: { userId: string } },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UnifiedAdvanceBody)) input: AdvanceInput,
  ) {
    return this.unified.advance(req.user.userId, id, input);
  }
}

import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ConsumerAuthGuard } from '../../auth/consumer-auth.guard';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { UnifiedLocalGuard } from '../unified/unified-local.guard';
import { NairaTransfersService } from './transfers.service';
import { NairaTransferBody, NairaTransferQuoteBody } from './transfers.types';
import type {
  NairaTransferInput,
  NairaTransferQuoteInput,
} from './transfers.types';

@Controller('fiat/banking/transfers')
@UseGuards(ConsumerAuthGuard)
export class NairaTransfersController {
  constructor(private readonly transfers: NairaTransfersService) {}
  @Get()
  list(@Req() req: { user: { userId: string } }) {
    return this.transfers.list(req.user.userId);
  }
  @Post('quotes')
  quote(
    @Req() req: { user: { userId: string } },
    @Body(new ZodValidationPipe(NairaTransferQuoteBody))
    input: NairaTransferQuoteInput,
  ) {
    return this.transfers.quote(req.user.userId, input);
  }
  @Post()
  send(
    @Req() req: { user: { userId: string } },
    @Body(new ZodValidationPipe(NairaTransferBody)) input: NairaTransferInput,
  ) {
    return this.transfers.send(req.user.userId, input);
  }
}

@Controller('dev/fiat/banking/transfers')
@UseGuards(UnifiedLocalGuard)
export class NairaTransfersLocalController {
  constructor(private readonly transfers: NairaTransfersService) {}
  @Get()
  list(@Req() req: { user: { userId: string } }) {
    return this.transfers.list(req.user.userId);
  }
  @Post('quotes')
  quote(
    @Req() req: { user: { userId: string } },
    @Body(new ZodValidationPipe(NairaTransferQuoteBody))
    input: NairaTransferQuoteInput,
  ) {
    return this.transfers.quote(req.user.userId, input);
  }
  @Post()
  send(
    @Req() req: { user: { userId: string } },
    @Body(new ZodValidationPipe(NairaTransferBody)) input: NairaTransferInput,
  ) {
    return this.transfers.send(req.user.userId, input);
  }
}

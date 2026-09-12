import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConsumerAuthGuard } from '../auth/consumer-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { FiatService } from './fiat.service';
import {
  FiatQuoteRequest,
  FiatOrderRequest,
  FiatSimulationRequest,
} from './dtos';
import type {
  FiatQuoteRequestBody,
  FiatOrderRequestBody,
  FiatSimulationRequestBody,
} from './dtos';
type ConsumerRequest = { user: { userId: string } };

@Controller('fiat')
@UseGuards(ConsumerAuthGuard)
export class FiatController {
  constructor(private readonly fiat: FiatService) {}
  @Get('routes') routes() {
    return this.fiat.routes();
  }
  @Post('quotes') quote(
    @Req() req: ConsumerRequest,
    @Body(new ZodValidationPipe(FiatQuoteRequest)) input: FiatQuoteRequestBody,
  ) {
    return this.fiat.quote(req.user.userId, input);
  }
  @Get('orders') orders(@Req() req: ConsumerRequest) {
    return this.fiat.list(req.user.userId);
  }
  @Get('orders/:id') order(
    @Req() req: ConsumerRequest,
    @Param('id') id: string,
  ) {
    return this.fiat.order(req.user.userId, id);
  }
  @Post('orders') create(
    @Req() req: ConsumerRequest,
    @Body(new ZodValidationPipe(FiatOrderRequest)) input: FiatOrderRequestBody,
  ) {
    return this.fiat.create(req.user.userId, input);
  }
  @Post('orders/:id/simulate') simulate(
    @Req() req: ConsumerRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(FiatSimulationRequest))
    input: FiatSimulationRequestBody,
  ) {
    return this.fiat.simulate(req.user.userId, id, input);
  }
}

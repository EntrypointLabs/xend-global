import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ConsumerAuthGuard } from '../../auth/consumer-auth.guard';
import { UnifiedLocalGuard } from '../unified/unified-local.guard';
import { ObservedBalancesService } from './observed-balances.service';

@Controller('fiat/balances')
@UseGuards(ConsumerAuthGuard)
export class ObservedBalancesController {
  constructor(private readonly balances: ObservedBalancesService) {}
  @Get()
  get(@Req() req: { user: { userId: string } }) {
    return this.balances.get(req.user.userId);
  }
}

/** Local demo uses the same owned account/vault lookup; it invents no funds. */
@Controller('dev/fiat/balances')
@UseGuards(UnifiedLocalGuard)
export class ObservedBalancesLocalController {
  constructor(private readonly balances: ObservedBalancesService) {}
  @Get()
  get(@Req() req: { user: { userId: string } }) {
    return this.balances.get(req.user.userId);
  }
}

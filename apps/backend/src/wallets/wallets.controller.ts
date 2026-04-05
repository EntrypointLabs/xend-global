import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { WalletsService } from './wallets.service';

@Controller('wallets')
@UseGuards(AuthGuard('jwt'))
export class WalletsController {
  constructor(private wallets: WalletsService) {}

  @Get('me')
  getWallet(@Req() req) {
    return this.wallets.getWallet(req.user.userId);
  }

  @Get('me/balances')
  getBalances(@Req() req) {
    return this.wallets.getBalances(req.user.userId);
  }
}

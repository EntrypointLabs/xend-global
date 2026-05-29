import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { WalletsService } from './wallets.service';

interface AuthenticatedRequest extends Request {
  user: { userId: string; gridAccountId: string };
}

@Controller('wallets')
@UseGuards(AuthGuard('jwt'))
export class WalletsController {
  constructor(private wallets: WalletsService) {}

  @Get('me')
  getWallet(@Req() req: AuthenticatedRequest) {
    console.log("req.user", req.user);
    return this.wallets.getWallet(req.user.userId);
  }

  @Get('me/balances')
  getBalances(@Req() req: AuthenticatedRequest) {
    console.log("req.user_balances", req.user);
    return this.wallets.getBalances(req.user.userId);
  }
}

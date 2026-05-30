import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { WalletsService } from './wallets.service';

interface AuthenticatedRequest extends Request {
  user: { userId: string; walletAddress: string };
}

/**
 * WalletsController — Phase 5 keeps only the spec-conformant Phase 1
 * Privy-shaped endpoints. The legacy Grid-backed `/wallets/me` +
 * `/wallets/me/balances` handlers were deleted with the GridService dep.
 */
@Controller()
@UseGuards(AuthGuard('jwt'))
export class WalletsController {
  constructor(private wallets: WalletsService) {}

  @Get('wallet/me')
  getMe(@Req() req: AuthenticatedRequest) {
    return this.wallets.getMe(req.user.userId);
  }

  @Get('wallet/me/balances')
  getMeBalances(@Req() req: AuthenticatedRequest) {
    return this.wallets.getMeBalances(req.user.userId);
  }
}

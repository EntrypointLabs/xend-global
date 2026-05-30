import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { WalletsService } from './wallets.service';

interface AuthenticatedRequest extends Request {
  user: { userId: string; walletAddress: string };
}

/**
 * Note on path naming: the controller is declared without a path
 * prefix because Phase 1 adds endpoints at BOTH the legacy `/wallets/*`
 * paths (Grid-shaped, mobile still calls these pre-Phase-4) AND the
 * new spec-conformant `/wallet/*` paths (singular, used by /auth/exchange
 * consumers). The two sets coexist until Phase 5 deletes the legacy
 * pair. See PLAN.md "Files Touched" + "HARD RULES".
 */
@Controller()
@UseGuards(AuthGuard('jwt'))
export class WalletsController {
  constructor(private wallets: WalletsService) {}

  // ── Legacy (Grid-shaped) ───────────────────────────────────────────
  // Mobile calls these until Phase 4. They go through GridService.

  @Get('wallets/me')
  getWalletLegacy(@Req() req: AuthenticatedRequest) {
    return this.wallets.getWallet(req.user.userId);
  }

  @Get('wallets/me/balances')
  getBalancesLegacy(@Req() req: AuthenticatedRequest) {
    return this.wallets.getBalances(req.user.userId);
  }

  // ── Phase 1 (Privy-shaped) ─────────────────────────────────────────
  // Backed by SolanaRpc (FailoverSolanaRpc). Mobile cuts over in Phase 4.

  @Get('wallet/me')
  getMe(@Req() req: AuthenticatedRequest) {
    return this.wallets.getMe(req.user.userId);
  }

  @Get('wallet/me/balances')
  getMeBalances(@Req() req: AuthenticatedRequest) {
    return this.wallets.getMeBalances(req.user.userId);
  }
}

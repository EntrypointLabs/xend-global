import {
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AllowEntry } from '../auth/allow-entry.decorator';
import { ConsumerAuthGuard } from '../auth/consumer-auth.guard';
import { Request } from 'express';
import { AccountHasBalanceError, WalletsService } from './wallets.service';

interface AuthenticatedRequest extends Request {
  user: { userId: string; walletAddress: string };
}

@Controller()
@UseGuards(ConsumerAuthGuard)
export class WalletsController {
  constructor(private wallets: WalletsService) {}

  @Get('wallet/me')
  @AllowEntry()
  getMe(@Req() req: AuthenticatedRequest) {
    return this.wallets.getMe(req.user.userId);
  }

  @Get('wallet/me/balances')
  @AllowEntry()
  getMeBalances(@Req() req: AuthenticatedRequest) {
    return this.wallets.getMeBalances(req.user.userId);
  }

  @Delete('wallet/me')
  async deleteMe(@Req() req: AuthenticatedRequest) {
    try {
      return await this.wallets.deleteMe(req.user.userId);
    } catch (err) {
      if (err instanceof AccountHasBalanceError) {
        throw new HttpException(
          { code: err.code, message: err.message },
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
  }
}

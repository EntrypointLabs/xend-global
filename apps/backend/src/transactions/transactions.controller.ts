import { Controller, Post, Get, Body, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { TransactionsService } from './transactions.service';
import { type SendTransactionDto } from './types';

interface AuthenticatedRequest extends Request {
  user: { userId: string; walletAddress: string };
}

@Controller('transactions')
@UseGuards(AuthGuard('jwt'))
export class TransactionsController {
  constructor(private txs: TransactionsService) {}

  @Post('send')
  send(@Req() req: AuthenticatedRequest, @Body() dto: SendTransactionDto) {
    return this.txs.send(req.user.userId, dto);
  }

  @Get()
  getHistory(@Req() req: AuthenticatedRequest) {
    return this.txs.getHistory(req.user.userId);
  }
}

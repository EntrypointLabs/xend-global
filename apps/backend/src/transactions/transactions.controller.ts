import { Controller, Post, Get, Body, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TransactionsService } from './transactions.service';

class SendDto {
  toAddress: string;
  amount: string;
  token: string;
  sessionSecrets: unknown;
  session: unknown;
}

@Controller('transactions')
@UseGuards(AuthGuard('jwt'))
export class TransactionsController {
  constructor(private txs: TransactionsService) {}

  @Post('send')
  send(@Req() req, @Body() dto: SendDto) {
    return this.txs.send(req.user.userId, dto);
  }

  @Get()
  getHistory(@Req() req) {
    return this.txs.getHistory(req.user.userId);
  }
}

import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ConsumerAuthGuard } from '../../auth/consumer-auth.guard';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { UnifiedLocalGuard } from '../unified/unified-local.guard';
import { BankRecipientsService } from './recipients.service';
import {
  BankCandidatesBody,
  ResolveBankRecipientBody,
} from './recipients.types';
import type {
  BankCandidatesInput,
  ResolveBankRecipientInput,
} from './recipients.types';

@Controller('fiat/banking')
@UseGuards(ConsumerAuthGuard)
export class BankRecipientsController {
  constructor(private readonly recipients: BankRecipientsService) {}
  @Get('banks')
  async banks() {
    return { banks: await this.recipients.banks() };
  }
  @Post('recipients/candidates')
  async candidates(
    @Body(new ZodValidationPipe(BankCandidatesBody)) input: BankCandidatesInput,
  ) {
    return { banks: await this.recipients.candidates(input.accountNumber) };
  }
  @Post('recipients/resolve')
  resolve(
    @Req() req: { user: { userId: string } },
    @Body(new ZodValidationPipe(ResolveBankRecipientBody))
    input: ResolveBankRecipientInput,
  ) {
    return this.recipients.resolve(req.user.userId, input);
  }
}

@Controller('dev/fiat/banking')
@UseGuards(UnifiedLocalGuard)
export class BankRecipientsLocalController {
  constructor(private readonly recipients: BankRecipientsService) {}
  @Get('banks')
  async banks() {
    return { banks: await this.recipients.banks() };
  }
  @Post('recipients/candidates')
  async candidates(
    @Body(new ZodValidationPipe(BankCandidatesBody)) input: BankCandidatesInput,
  ) {
    return { banks: await this.recipients.candidates(input.accountNumber) };
  }
  @Post('recipients/resolve')
  resolve(
    @Req() req: { user: { userId: string } },
    @Body(new ZodValidationPipe(ResolveBankRecipientBody))
    input: ResolveBankRecipientInput,
  ) {
    return this.recipients.resolve(req.user.userId, input);
  }
}

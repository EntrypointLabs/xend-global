import { BankingRegistry } from './banking/banking.registry';
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
import { FiatVerificationService } from './verification/verification.service';
import { PayoutBanksService } from './providers/paycrest/payout-banks.service';
import {
  AccountNumberParam,
  BankAccountLookupRequest,
  FiatQuoteRequest,
  FiatOrderRequest,
  FiatSimulationRequest,
  VerificationCodeRequest,
  VerificationStartRequest,
} from './dtos';
import type {
  BankAccountLookupBody,
  FiatQuoteRequestBody,
  FiatOrderRequestBody,
  FiatSimulationRequestBody,
  VerificationCodeBody,
  VerificationStartBody,
} from './dtos';
type ConsumerRequest = { user: { userId: string } };

@Controller('fiat')
@UseGuards(ConsumerAuthGuard)
export class FiatController {
  constructor(
    private readonly fiat: FiatService,
    private readonly banking: BankingRegistry,
    private readonly verification: FiatVerificationService,
    private readonly payoutBanks: PayoutBanksService,
  ) {}
  @Get('limits') limits(@Req() req: ConsumerRequest) {
    return this.fiat.limits(req.user.userId);
  }
  @Get('payout-banks') payoutBankList() {
    return this.payoutBanks.list();
  }
  @Get('payout-banks/candidates/:accountNumber') payoutBankCandidates(
    @Param('accountNumber', new ZodValidationPipe(AccountNumberParam))
    accountNumber: string,
  ) {
    return this.payoutBanks.candidates(accountNumber);
  }
  @Post('payout-banks/lookup') lookupPayoutAccount(
    @Body(new ZodValidationPipe(BankAccountLookupRequest))
    input: BankAccountLookupBody,
  ) {
    return this.payoutBanks.lookup(input.bankCode, input.accountNumber);
  }
  @Get('verification') verificationStatus(@Req() req: ConsumerRequest) {
    return this.verification.view(req.user.userId);
  }
  @Get('verification/consent') verificationConsent() {
    return this.verification.consent();
  }
  @Post('verification') startVerification(
    @Req() req: ConsumerRequest,
    @Body(new ZodValidationPipe(VerificationStartRequest))
    input: VerificationStartBody,
  ) {
    return this.verification.start(
      req.user.userId,
      input.bvn,
      input.consentVersion,
    );
  }
  @Post('verification/code') confirmVerification(
    @Req() req: ConsumerRequest,
    @Body(new ZodValidationPipe(VerificationCodeRequest))
    input: VerificationCodeBody,
  ) {
    return this.verification.confirm(req.user.userId, input.code);
  }
  @Post('verification/code/resend') resendVerification(
    @Req() req: ConsumerRequest,
  ) {
    return this.verification.resend(req.user.userId);
  }
  @Get('banking/capabilities') bankingCapabilities() {
    return { providers: this.banking.capabilities() };
  }
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

import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ConsumerAuthGuard } from '../../auth/consumer-auth.guard';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { UnifiedLocalGuard } from '../unified/unified-local.guard';
import { NairaAccountsService } from './accounts.service';
import {
  CreateNairaAccountBody,
  ReconcileNairaAccountBody,
} from './accounts.types';
import type {
  CreateNairaAccountInput,
  ReconcileNairaAccountInput,
} from './accounts.types';

@Controller('fiat/banking/accounts')
@UseGuards(ConsumerAuthGuard)
export class NairaAccountsController {
  constructor(private readonly accounts: NairaAccountsService) {}
  @Get()
  list(@Req() req: { user: { userId: string } }) {
    return this.accounts.list(req.user.userId);
  }
  @Post('reconcile')
  reconcile(
    @Req() req: { user: { userId: string } },
    @Body(new ZodValidationPipe(ReconcileNairaAccountBody))
    input: ReconcileNairaAccountInput,
  ) {
    return this.accounts.reconcile(req.user.userId, input.accountId);
  }
  @Post()
  create(
    @Req() req: { user: { userId: string } },
    @Body(new ZodValidationPipe(CreateNairaAccountBody))
    input: CreateNairaAccountInput,
  ) {
    return this.accounts.create(req.user.userId, input);
  }
}

/** Loopback-only developer identity; service only supports credentialed sandbox. */
@Controller('dev/fiat/banking/accounts')
@UseGuards(UnifiedLocalGuard)
export class NairaAccountsLocalController {
  constructor(private readonly accounts: NairaAccountsService) {}
  @Get()
  list(@Req() req: { user: { userId: string } }) {
    return this.accounts.list(req.user.userId);
  }
  @Post('reconcile')
  reconcile(
    @Req() req: { user: { userId: string } },
    @Body(new ZodValidationPipe(ReconcileNairaAccountBody))
    input: ReconcileNairaAccountInput,
  ) {
    return this.accounts.reconcile(req.user.userId, input.accountId);
  }
  @Post()
  create(
    @Req() req: { user: { userId: string } },
    @Body(new ZodValidationPipe(CreateNairaAccountBody))
    input: CreateNairaAccountInput,
  ) {
    return this.accounts.create(req.user.userId, input);
  }
}

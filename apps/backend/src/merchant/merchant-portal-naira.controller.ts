import {
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  BankAccountUnconfirmedError,
  PajSettlementProvider,
} from '../settlement/providers/paj/paj-settlement.provider';
import { SettlementProvisioningService } from '../settlement/settlement-provisioning.service';
import { SettlementAccountNotProvisionedError } from '../settlement/settlement.errors';
import { MerchantAuditService } from './merchant-audit.service';
import { MerchantOwnerService } from './merchant-owner.service';

const BankAccount = z.object({
  bankCode: z.string().trim().min(1).max(20),
  accountNumber: z
    .string()
    .regex(/^\d{10}$/, 'Enter a 10-digit account number'),
});
const NairaDestination = BankAccount.extend({
  // The name the owner was shown and agreed to. A different name at the bank
  // by the time they confirm means they would be paying someone else.
  confirmedAccountName: z.string().min(1),
});

/** Naira settlement setup: pick a bank, confirm the account, connect it. */
@Controller('merchant-portal/naira')
export class MerchantPortalNairaController {
  constructor(
    private readonly owner: MerchantOwnerService,
    private readonly naira: PajSettlementProvider,
    private readonly provisioning: SettlementProvisioningService,
    private readonly config: ConfigService,
    private readonly audit: MerchantAuditService,
  ) {}

  @Get('banks')
  async banks(@Headers('authorization') authorization?: string) {
    await this.owner.owned(authorization);
    this.assertAvailable();
    return { banks: await this.naira.listBanks() };
  }

  @Post('account')
  async account(
    @Headers('authorization') authorization: string | undefined,
    @Body(new ZodValidationPipe(BankAccount))
    body: z.infer<typeof BankAccount>,
  ) {
    await this.owner.owned(authorization);
    this.assertAvailable();
    return this.confirm(body);
  }

  @Post('destination')
  async destination(
    @Headers('authorization') authorization: string | undefined,
    @Body(new ZodValidationPipe(NairaDestination))
    body: z.infer<typeof NairaDestination>,
  ) {
    const merchant = await this.owner.owned(authorization);
    this.assertAvailable();
    if (
      this.config.get<string>('SOLANA_CLUSTER') !== 'devnet' &&
      merchant.kybStatus !== 'verified'
    )
      throw new ConflictException('Business verification is required');

    const bankAccount = {
      bankCode: body.bankCode,
      accountNumber: body.accountNumber,
    };
    const confirmed = await this.confirm(bankAccount);
    if (confirmed.accountName !== body.confirmedAccountName)
      throw new ConflictException(
        'The account name changed. Check the account again before connecting it.',
      );

    try {
      const result = await this.provisioning.provisionOrLink(
        merchant.id,
        { currency: 'NGN', bankAccount },
        (tx) =>
          this.audit.record(
            {
              merchantId: merchant.id,
              actor: merchant.ownerProviderId ?? 'unknown',
              action: 'destination.provision',
              target: merchant.id,
            },
            tx,
          ),
      );
      // An existing receiving account is returned untouched, so a Merchant
      // already settling in USDC is told rather than silently left there.
      if (result.provider !== this.naira.capabilities.provider)
        throw new ConflictException(
          'This Merchant already has a receiving account.',
        );
      return result;
    } catch (error) {
      if (error instanceof SettlementAccountNotProvisionedError)
        throw new ConflictException(
          'The receiving account is not confirmed yet. Wait a moment and retry. No Payment has been made.',
        );
      throw error;
    }
  }

  private assertAvailable(): void {
    if (!this.naira.enabled)
      throw new NotFoundException('Naira settlement is not available');
  }

  private async confirm(bankAccount: z.infer<typeof BankAccount>) {
    try {
      return await this.naira.confirmBankAccount(bankAccount);
    } catch (error) {
      if (error instanceof BankAccountUnconfirmedError)
        throw new UnprocessableEntityException(
          'We could not confirm that account. Check the bank and account number.',
        );
      throw error;
    }
  }
}

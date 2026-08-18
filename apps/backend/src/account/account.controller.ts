import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';

import { AttestationService } from '../attestation/attestation.service';
import {
  AttestationNonceError,
  AttestationNotConfiguredError,
  AttestationRejectedError,
} from '../attestation/attestation.errors';
import { UnsafeSubOrganizationError } from '../turnkey/turnkey.errors';
import {
  AccountCreationError,
  IncompleteSignerSetError,
} from './account.errors';
import { AccountService } from './account.service';
import { SweepService } from './sweep.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  EnrolAccountSchema,
  SubmitProvisioningStepSchema,
  type EnrolAccountDto,
  type SubmitProvisioningStepDto,
} from './dtos';
import { ProvisioningService } from './provisioning.service';
import { SpendingLimitService } from './spending-limit.service';

interface AuthenticatedRequest extends Request {
  user: { userId: string; walletAddress: string };
}

@Controller('account')
@UseGuards(AuthGuard('jwt'))
export class AccountController {
  private readonly logger = new Logger(AccountController.name);

  constructor(
    private readonly accounts: AccountService,
    private readonly attestation: AttestationService,
    private readonly sweep: SweepService,
    private readonly provisioning: ProvisioningService,
    private readonly spendingLimits: SpendingLimitService,
  ) {}

  /**
   * What is still sitting in the Privy wallet after enrolment.
   *
   * A plan only. The transfer is signed by Privy on the device, so the backend
   * cannot move these funds and deliberately has no way to.
   */
  @Get('sweep')
  getSweepPlan(@Req() req: AuthenticatedRequest) {
    return this.sweep.plan(req.user.userId);
  }

  /**
   * The challenge the device attests over. Issued per attempt, single use, and
   * bound to the caller, so an attestation cannot be replayed or borrowed.
   */
  @Post('enrolment/nonce')
  async issueNonce(@Req() req: AuthenticatedRequest) {
    return { nonce: await this.attestation.issueNonce(req.user.userId) };
  }

  /**
   * Creates the Consumer's Account.
   *
   * The hardware public key comes out of the verified attestation rather than
   * off the request body. A client-supplied key would let a caller attest with
   * a real device and enrol a software key it actually controls, which is the
   * whole attack this endpoint exists to stop.
   */
  @Post('enrolment')
  async enrol(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(EnrolAccountSchema)) body: EnrolAccountDto,
  ) {
    try {
      const verified = await this.attestation.verify(req.user.userId, {
        platform: body.platform,
        attestation: body.attestation,
        nonce: body.nonce,
      });

      const account = await this.accounts.createAccount({
        userId: req.user.userId,
        primarySigner: req.user.walletAddress,
        hardwarePublicKey: verified.hardwarePublicKey,
      });

      return {
        address: account.vaultAddress,
        security: verified.security,
      };
    } catch (err) {
      // toHttp deliberately flattens everything into "could not create the
      // Account", which is right for the caller and useless for us. By the
      // time enrolment fails here a Turnkey sub-organization already exists,
      // so the cause is worth more than the status code.
      this.logger.error(
        `account.enrolment_failed userId=${req.user.userId}: ${describeError(err)}`,
      );
      throw toHttp(err);
    }
  }

  /**
   * The next provisioning transaction for the Consumer to sign, or `done`.
   *
   * Derived from the chain on every call rather than from a cursor the client
   * carries, so an interrupted run resumes exactly where it stopped and a
   * replayed call is harmless.
   */
  @Post('provisioning/next')
  async nextProvisioningStep(@Req() req: AuthenticatedRequest) {
    try {
      return await this.provisioning.prepareNext(req.user.userId);
    } catch (err) {
      this.logger.error(
        `provisioning.prepare_failed userId=${req.user.userId}: ${describeError(err)}`,
      );
      throw toHttp(err);
    }
  }

  @Post('provisioning/submit')
  async submitProvisioningStep(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(SubmitProvisioningStepSchema))
    body: SubmitProvisioningStepDto,
  ) {
    try {
      const signature = await this.provisioning.submit(
        req.user.userId,
        body.signedTxBase64,
      );
      return { signature };
    } catch (err) {
      this.logger.error(
        `provisioning.submit_failed userId=${req.user.userId}: ${describeError(err)}`,
      );
      throw toHttp(err);
    }
  }

  @Get('me')
  async getMe(@Req() req: AuthenticatedRequest) {
    const account = await this.accounts.findByUserId(req.user.userId);
    if (!account) {
      throw new HttpException(
        { code: 'NO_ACCOUNT', message: 'No Account has been created yet' },
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      address: account.vaultAddress,
      signers: {
        primary: account.primarySigner,
        approval: account.approvalSigner,
      },
      // The device stamps Turnkey requests itself, so it needs to know which
      // sub-organization it is talking to. Not a secret: holding it proves
      // nothing without the hardware key that signs for it.
      approvalSubOrgId: account.approvalSubOrgId,
      // Carried on the Account rather than given its own endpoint: everything
      // that wants the limit already holds the Account, and a second call
      // would let the two disagree about which Account they describe.
      spendingLimit: await this.spendingLimits.forAccount(
        account.settingsAddress,
      ),
    };
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? (err.stack ?? err.message) : String(err);
}

function toHttp(err: unknown): HttpException {
  if (
    err instanceof AttestationRejectedError ||
    err instanceof AttestationNonceError
  ) {
    return new HttpException(
      { code: err.code, message: err.message },
      HttpStatus.UNAUTHORIZED,
    );
  }
  if (err instanceof IncompleteSignerSetError) {
    return new HttpException(
      { code: err.code, message: err.message },
      HttpStatus.BAD_REQUEST,
    );
  }
  // An unsafe sub-organization is ours to clean up, not the caller's to retry
  // against. It is deliberately not distinguished from any other outage here.
  if (
    err instanceof UnsafeSubOrganizationError ||
    err instanceof AccountCreationError ||
    err instanceof AttestationNotConfiguredError
  ) {
    return new HttpException(
      { code: err.code, message: 'Could not create the Account' },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
  return new HttpException(
    {
      code: 'ACCOUNT_ENROLMENT_FAILED',
      message: 'Could not create the Account',
    },
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
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
import { TurnkeyService } from '../turnkey/turnkey.service';
import { AccountChangeService } from './account-change.service';
import { UnsafeSubOrganizationError } from '../turnkey/turnkey.errors';
import {
  DuplicateRecoveryChannelError,
  LastRecoverySignerError,
  RecoveryChangeInFlightError,
  RecoverySignerLimitError,
  UnknownRecoverySignerError,
} from '../recovery/recovery.errors';
import {
  AccountCreationError,
  IncompleteSignerSetError,
} from './account.errors';
import { AccountService } from './account.service';
import { SweepService } from './sweep.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  AddRecoveryWalletSchema,
  EnrolAccountSchema,
  SubmitProvisioningStepSchema,
  SubmitRecoveryChangeSchema,
  SubmitRejectionSchema,
  type AddRecoveryWalletDto,
  type EnrolAccountDto,
  type SubmitProvisioningStepDto,
  type SubmitRecoveryChangeDto,
  type SubmitRejectionDto,
} from './dtos';
import { ProvisioningService } from './provisioning.service';
import { RecoveryService } from '../recovery/recovery.service';
import { RecoveryChangeService } from './recovery-change.service';
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
    private readonly turnkey: TurnkeyService,
    private readonly changes: AccountChangeService,
    private readonly recovery: RecoveryService,
    private readonly recoveryChanges: RecoveryChangeService,
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
      // Discriminated on the attestation, not on the key: iOS sends a key on
      // the fresh path too, bound into the attested challenge.
      const verified =
        'attestation' in body
          ? await this.attestation.verify(req.user.userId, {
              platform: body.platform,
              attestation: body.attestation,
              nonce: body.nonce,
              hardwarePublicKey: body.hardwarePublicKey,
            })
          : await this.resumeEnrolment(req.user.userId, body.hardwarePublicKey);

      const account = await this.accounts.createAccount({
        userId: req.user.userId,
        primarySigner: req.user.walletAddress,
        hardwarePublicKey: verified.hardwarePublicKey,
        security: verified.security ?? undefined,
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
   * The settings change waiting on this Consumer's Account, or null.
   *
   * Polled by the app so the notice survives a push that never arrived: a
   * Consumer who has notifications off, or whose token went stale, still sees
   * the change the next time they open Xend.
   */
  @Get('changes/pending')
  pendingChange(@Req() req: AuthenticatedRequest) {
    return this.changes.pending(req.user.userId).then((change) => ({ change }));
  }

  /**
   * Builds the rejection for the Consumer to sign.
   *
   * Rejecting is the only defence the time lock actually provides, so it is a
   * plain prepare/submit pair like any other transaction rather than anything
   * the Consumer has to be walked through.
   */
  @Post('changes/reject/prepare')
  async prepareRejection(@Req() req: AuthenticatedRequest) {
    try {
      return await this.changes.prepareRejection(req.user.userId);
    } catch (err) {
      throw toHttp(err);
    }
  }

  @Post('changes/reject/submit')
  async submitRejection(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(SubmitRejectionSchema))
    body: SubmitRejectionDto,
  ) {
    try {
      return {
        signature: await this.changes.submitRejection(
          req.user.userId,
          body.signedTxBase64,
        ),
      };
    } catch (err) {
      throw toHttp(err);
    }
  }

  /** The Consumer's recovery keys, including any change still in flight. */
  @Get('recovery')
  async recoveryKeys(@Req() req: AuthenticatedRequest) {
    try {
      return { keys: await this.recovery.list(req.user.userId) };
    } catch (err) {
      throw toHttp(err);
    }
  }

  /**
   * Stages an external wallet as a recovery key and returns its first step.
   *
   * Staged, not added: it reaches the signer set only once the settings change
   * this starts has been approved twice and waited out the time lock. Saying
   * otherwise in the response would have the app tell a Consumer they are
   * protected a day before they are.
   */
  @Post('recovery/external-wallet')
  async addRecoveryWallet(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(AddRecoveryWalletSchema))
    body: AddRecoveryWalletDto,
  ) {
    try {
      await this.assertNotAnActiveSigner(req.user.userId, body.address);
      const key = await this.recovery.addExternalWallet(
        req.user.userId,
        body.address,
      );
      const plan = await this.recoveryChanges.start(req.user.userId, key.id);
      return { key, plan };
    } catch (err) {
      throw toHttp(err);
    }
  }

  @Post('recovery/:id/remove')
  async removeRecoveryKey(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    try {
      await this.recovery.remove(req.user.userId, id);
      return { plan: await this.recoveryChanges.start(req.user.userId, id) };
    } catch (err) {
      throw toHttp(err);
    }
  }

  /**
   * The next step of the recovery key change, or done.
   *
   * Also what reconciles the staged rows with the chain, so the app calls it
   * until it says done rather than assuming its own last step landed.
   */
  @Post('recovery/change/next')
  async nextRecoveryChangeStep(@Req() req: AuthenticatedRequest) {
    try {
      return await this.recoveryChanges.next(req.user.userId);
    } catch (err) {
      throw toHttp(err);
    }
  }

  @Post('recovery/change/submit')
  async submitRecoveryChangeStep(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(SubmitRecoveryChangeSchema))
    body: SubmitRecoveryChangeDto,
  ) {
    try {
      return {
        signature: await this.recoveryChanges.submit(
          req.user.userId,
          body.signedTxBase64,
        ),
      };
    } catch (err) {
      throw toHttp(err);
    }
  }

  /**
   * Picks up an enrolment that already attested this device.
   *
   * A key the backend has never seen is refused. The device generates a fresh
   * one on every attestation, so accepting an unknown key would let a caller
   * with real hardware enrol a software key instead — the whole reason the
   * fresh path reads the key out of the attestation rather than the body.
   */
  /**
   * Refuses an Active Key offered as a recovery key.
   *
   * Adding one would be rejected on chain as a duplicate signer, but only at
   * execute, a day later, having spent an index. It would also be pointless:
   * recovery exists to cover the loss of an Active Key, and a key that is both
   * covers nothing.
   */
  private async assertNotAnActiveSigner(userId: string, address: string) {
    const account = await this.accounts.findByUserId(userId);
    if (
      account &&
      (account.primarySigner === address || account.approvalSigner === address)
    ) {
      throw new DuplicateRecoveryChannelError(
        'that key already protects this Account as an Active Key',
      );
    }
  }

  private async resumeEnrolment(
    userId: string,
    hardwarePublicKey: string,
  ): Promise<{ hardwarePublicKey: string; security: string | null }> {
    const enrolled = await this.turnkey.findEnrolledDevice(
      userId,
      hardwarePublicKey,
    );
    if (!enrolled) {
      throw new BadRequestException(
        'This device has not been attested; enrol with an attestation first',
      );
    }
    return { hardwarePublicKey, security: enrolled.security };
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
  // Recovery key rules are the Consumer's to act on: which key, why it was
  // refused, and what to do instead. Flattening them into "could not create
  // the Account" would leave the app with nothing to say.
  if (err instanceof UnknownRecoverySignerError) {
    return new HttpException(
      { code: err.code, message: err.message },
      HttpStatus.NOT_FOUND,
    );
  }
  if (
    err instanceof LastRecoverySignerError ||
    err instanceof RecoverySignerLimitError ||
    err instanceof DuplicateRecoveryChannelError ||
    err instanceof RecoveryChangeInFlightError
  ) {
    return new HttpException(
      { code: err.code, message: err.message },
      HttpStatus.CONFLICT,
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

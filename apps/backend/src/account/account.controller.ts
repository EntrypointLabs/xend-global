import {
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
import { AllowEntry } from '../auth/allow-entry.decorator';
import { ConsumerAuthGuard } from '../auth/consumer-auth.guard';
import { Request } from 'express';

import { AttestationService } from '../attestation/attestation.service';
import {
  AttestationNonceError,
  AttestationNotConfiguredError,
  AttestationRejectedError,
} from '../attestation/attestation.errors';
import { TurnkeyService } from '../turnkey/turnkey.service';
import { AccountChangeService } from './account-change.service';
import { PrimaryRotationService } from './primary-rotation.service';
import { UnsafeSubOrganizationError } from '../turnkey/turnkey.errors';
import {
  ChallengeAttemptsExhaustedError,
  ContactEmailTakenError,
  ContactRecoverySignerError,
  DuplicateRecoveryChannelError,
  InvalidRecoveryCodeError,
  LastRecoverySignerError,
  NoRecoveryChallengeError,
  NoRotationInFlightError,
  RecoveryChangeInFlightError,
  RecoveryGrantExpiredError,
  RecoveryReleaseFrozenError,
  RecoverySignerLimitError,
  TooManyRecoveryCodesError,
  UnknownRecoverySignerError,
} from '../recovery/recovery.errors';
import {
  AccountCreationError,
  PasskeyInUseError,
  DeviceNotAttestedError,
  IncompleteSignerSetError,
} from './account.errors';
import { AccountService } from './account.service';
import { SweepService } from './sweep.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  AddRecoveryEmailSchema,
  AddRecoveryWalletSchema,
  EnrolAccountSchema,
  SubmitProvisioningStepSchema,
  NextDeviceRotationSchema,
  RequestRecoveryEmailCodeSchema,
  VerifyRecoveryEmailSchema,
  StartDeviceRotationSchema,
  SubmitRecoveryChangeSchema,
  SubmitRejectionSchema,
  VerifyRecoveryCodeSchema,
  type AddRecoveryEmailDto,
  type AddRecoveryWalletDto,
  type EnrolAccountDto,
  type SubmitProvisioningStepDto,
  type NextDeviceRotationDto,
  type RequestRecoveryEmailCodeDto,
  type VerifyRecoveryEmailDto,
  type StartDeviceRotationDto,
  type SubmitRecoveryChangeDto,
  type SubmitRejectionDto,
  type VerifyRecoveryCodeDto,
  StartPrimaryRotationSchema,
  type StartPrimaryRotationDto,
} from './dtos';
import { ProvisioningService } from './provisioning.service';
import { RecoveryService } from '../recovery/recovery.service';
import { RecoveryChangeService } from './recovery-change.service';
import { RecoveryChallengeService } from '../recovery/recovery-challenge.service';
import { DeviceRotationService } from './device-rotation.service';
import { SpendingLimitService } from './spending-limit.service';

interface AuthenticatedRequest extends Request {
  user: { userId: string; walletAddress: string };
}

@Controller('account')
@UseGuards(ConsumerAuthGuard)
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
    private readonly challenges: RecoveryChallengeService,
    private readonly rotations: DeviceRotationService,
    private readonly primaryRotations: PrimaryRotationService,
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
      // The ordinary first call from a phone holding another account's stale
      // key. Not an error: the client falls through to a fresh attestation,
      // and logging it as one buries the failures that are.
      if (err instanceof DeviceNotAttestedError) {
        this.logger.log(
          `account.enrolment_resume_unattested userId=${req.user.userId}`,
        );
        throw new HttpException(
          { code: err.code, message: err.message },
          HttpStatus.CONFLICT,
        );
      }
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
  @AllowEntry()
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
  @AllowEntry()
  async recoveryKeys(@Req() req: AuthenticatedRequest) {
    try {
      return { keys: await this.recovery.list(req.user.userId) };
    } catch (err) {
      throw this.recoveryFailure(req.user.userId, 'list', err);
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
      return await this.recovery.withChangeLock(req.user.userId, async () => {
        const key = await this.recovery.addExternalWallet(
          req.user.userId,
          body.address,
        );
        const plan = await this.recoveryChanges.start(req.user.userId, key.id);
        return { key, plan };
      });
    } catch (err) {
      throw this.recoveryFailure(req.user.userId, 'add_wallet', err);
    }
  }

  /**
   * Sends a code to an address being offered as a recovery key.
   *
   * Refused before anything is mailed when the address is already a recovery
   * channel on this Account, so a duplicate never costs the Consumer a mail
   * they have to go and read.
   */
  @Post('recovery/email/challenge')
  async requestRecoveryEmailCode(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(RequestRecoveryEmailCodeSchema))
    body: RequestRecoveryEmailCodeDto,
  ) {
    try {
      await this.recovery.assertEmailUnused(req.user.userId, body.email);
      const { expiresAt } = await this.challenges.issue(
        req.user.userId,
        body.email,
        'recovery_key_email',
      );
      return { sent: true, expiresAt: expiresAt.toISOString() };
    } catch (err) {
      throw this.recoveryFailure(req.user.userId, 'recovery_email_code', err);
    }
  }

  /** Checks the code, ahead of the review step that adds the key. */
  @Post('recovery/email/verify')
  async verifyRecoveryEmail(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(VerifyRecoveryEmailSchema))
    body: VerifyRecoveryEmailDto,
  ) {
    try {
      const { grantId, expiresAt } = await this.challenges.verify(
        req.user.userId,
        'recovery_key_email',
        body.code,
      );
      const grant = await this.challenges.assertGrant(
        req.user.userId,
        grantId,
        'recovery_key_email',
      );
      if (grant.target !== body.email) {
        throw new RecoveryGrantExpiredError(
          'that code was sent to a different address',
        );
      }
      return { grantId, expiresAt: expiresAt.toISOString() };
    } catch (err) {
      throw this.recoveryFailure(req.user.userId, 'verify_recovery_email', err);
    }
  }

  /**
   * Stages a proved email as a recovery key and starts the settings change
   * carrying it.
   *
   * Same shape as the wallet route, plus the grant. The key is not real until
   * that change executes, which waits out the time lock like every other.
   */
  @Post('recovery/email')
  async addRecoveryEmail(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(AddRecoveryEmailSchema))
    body: AddRecoveryEmailDto,
  ) {
    try {
      const grant = await this.challenges.assertGrant(
        req.user.userId,
        body.grantId,
        'recovery_key_email',
      );
      if (grant.target !== body.email) {
        throw new RecoveryGrantExpiredError(
          'that code proved a different address',
        );
      }

      const result = await this.recovery.withChangeLock(
        req.user.userId,
        async () => {
          const key = await this.recovery.addEmail(req.user.userId, body.email);
          const plan = await this.recoveryChanges.start(
            req.user.userId,
            key.id,
          );
          return { key, plan };
        },
      );
      await this.challenges.consume(body.grantId);
      return result;
    } catch (err) {
      throw this.recoveryFailure(req.user.userId, 'add_recovery_email', err);
    }
  }

  /**
   * Sends a code to the address that will replace the one on file.
   *
   * Refused before anything is mailed when the address is already a recovery
   * channel here or another Consumer's contact address. The current address
   * is not asked to prove anything: an attacker holding it could, and a
   * Consumer who has lost it could not, so proving it protects the wrong
   * party. The change is guarded by the two keys on the phone and the day it
   * takes instead.
   */
  @Post('recovery/contact/challenge')
  async requestContactRotationCode(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(RequestRecoveryEmailCodeSchema))
    body: RequestRecoveryEmailCodeDto,
  ) {
    try {
      await this.recovery.assertContactEmailAvailable(
        req.user.userId,
        body.email,
      );
      const { expiresAt } = await this.challenges.issue(
        req.user.userId,
        body.email,
        'contact_rotation',
      );
      return { sent: true, expiresAt: expiresAt.toISOString() };
    } catch (err) {
      throw this.recoveryFailure(req.user.userId, 'contact_code', err);
    }
  }

  @Post('recovery/contact/verify')
  async verifyContactRotation(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(VerifyRecoveryEmailSchema))
    body: VerifyRecoveryEmailDto,
  ) {
    try {
      const { grantId, expiresAt } = await this.challenges.verify(
        req.user.userId,
        'contact_rotation',
        body.code,
      );
      const grant = await this.challenges.assertGrant(
        req.user.userId,
        grantId,
        'contact_rotation',
      );
      if (grant.target !== body.email) {
        throw new RecoveryGrantExpiredError(
          'that code was sent to a different address',
        );
      }
      return { grantId, expiresAt: expiresAt.toISOString() };
    } catch (err) {
      throw this.recoveryFailure(req.user.userId, 'contact_verify', err);
    }
  }

  /**
   * Stages the change that moves the contact address, and starts it.
   *
   * A fresh recovery key sealed against the proved address goes in and the
   * key anchored on the current address comes out, in one settings change
   * that both Active Keys approve and that waits out the time lock. The
   * address on file does not move here. It follows the key when the change
   * executes, so a stolen session can stage this and still hand nothing over.
   */
  @Post('recovery/contact')
  async rotateContactEmail(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(AddRecoveryEmailSchema))
    body: AddRecoveryEmailDto,
  ) {
    try {
      const grant = await this.challenges.assertGrant(
        req.user.userId,
        body.grantId,
        'contact_rotation',
      );
      if (grant.target !== body.email) {
        throw new RecoveryGrantExpiredError(
          'that code proved a different address',
        );
      }

      const result = await this.recovery.withChangeLock(
        req.user.userId,
        async () => {
          const { key, retiring } = await this.recovery.stageContactRotation(
            req.user.userId,
            body.email,
          );
          const plan = await this.recoveryChanges.start(
            req.user.userId,
            key.id,
            retiring.id,
          );
          return { key, retiring, plan };
        },
      );
      await this.challenges.consume(body.grantId);
      return result;
    } catch (err) {
      throw this.recoveryFailure(req.user.userId, 'contact_rotate', err);
    }
  }

  @Post('recovery/:id/remove')
  async removeRecoveryKey(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    try {
      return await this.recovery.withChangeLock(req.user.userId, async () => {
        await this.recovery.remove(req.user.userId, id);
        return { plan: await this.recoveryChanges.start(req.user.userId, id) };
      });
    } catch (err) {
      throw this.recoveryFailure(req.user.userId, 'remove', err);
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
      throw this.recoveryFailure(req.user.userId, 'change_next', err);
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
      throw this.recoveryFailure(req.user.userId, 'change_submit', err);
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
  /**
   * Mails a code to the address already on the Account.
   *
   * The response says nothing about the inbox. A caller holding a stolen
   * passkey learns only that a code went somewhere, which is what the real
   * owner needs them to learn.
   */
  @Post('recovery/device/challenge')
  @AllowEntry()
  async requestDeviceRotationCode(@Req() req: AuthenticatedRequest) {
    try {
      const email = await this.accounts.contactEmail(req.user.userId);
      if (!email) {
        throw new IncompleteSignerSetError(
          'this Account has no email on file to send a code to',
        );
      }
      const { expiresAt } = await this.challenges.issue(
        req.user.userId,
        email,
        'device_rotation',
      );
      return { sent: true, expiresAt: expiresAt.toISOString() };
    } catch (err) {
      throw this.recoveryFailure(req.user.userId, 'device_challenge', err);
    }
  }

  @Post('recovery/device/verify')
  @AllowEntry()
  async verifyDeviceRotationCode(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(VerifyRecoveryCodeSchema))
    body: VerifyRecoveryCodeDto,
  ) {
    try {
      const { grantId, expiresAt } = await this.challenges.verify(
        req.user.userId,
        'device_rotation',
        body.code,
      );
      return { grantId, expiresAt: expiresAt.toISOString() };
    } catch (err) {
      throw this.recoveryFailure(req.user.userId, 'device_verify', err);
    }
  }

  /**
   * Enrols this phone's hardware key and stages the swap that puts it in the
   * signer set. See {@link DeviceRotationService}.
   */
  @Post('recovery/device/start')
  @AllowEntry()
  async startDeviceRotation(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(StartDeviceRotationSchema))
    body: StartDeviceRotationDto,
  ) {
    try {
      // The key comes out of the attestation, never off the body. Same rule as
      // enrolment, and it matters more here: this one joins the signer set of
      // an Account that already exists.
      const verified =
        'attestation' in body
          ? await this.attestation.verify(req.user.userId, {
              platform: body.platform,
              attestation: body.attestation,
              nonce: body.nonce,
              hardwarePublicKey: body.hardwarePublicKey,
            })
          : await this.resumeEnrolment(req.user.userId, body.hardwarePublicKey);

      return await this.rotations.start(req.user.userId, body.grantId, {
        hardwarePublicKey: verified.hardwarePublicKey,
        security: verified.security ?? undefined,
      });
    } catch (err) {
      throw this.recoveryFailure(req.user.userId, 'device_start', err);
    }
  }

  /**
   * The next step, and the reconciler that commits the swap once the chain
   * has executed it. Called until it says done.
   */
  @Post('recovery/device/next')
  @AllowEntry()
  async nextDeviceRotationStep(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(NextDeviceRotationSchema))
    body: NextDeviceRotationDto,
  ) {
    try {
      return await this.rotations.next(req.user.userId, body.grantId);
    } catch (err) {
      throw this.recoveryFailure(req.user.userId, 'device_next', err);
    }
  }

  @Post('recovery/device/submit')
  @AllowEntry()
  async submitDeviceRotationStep(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(SubmitRecoveryChangeSchema))
    body: SubmitRecoveryChangeDto,
  ) {
    try {
      return {
        signature: await this.rotations.submit(
          req.user.userId,
          body.signedTxBase64,
        ),
      };
    } catch (err) {
      throw this.recoveryFailure(req.user.userId, 'device_submit', err);
    }
  }

  /** Mails a code to the address on the Account, toward replacing its passkey. */
  @Post('recovery/primary/challenge')
  @AllowEntry()
  async requestPrimaryRotationCode(@Req() req: AuthenticatedRequest) {
    try {
      const email = await this.accounts.contactEmail(req.user.userId);
      if (!email) {
        throw new IncompleteSignerSetError(
          'this Account has no email on file to send a code to',
        );
      }
      const { expiresAt } = await this.challenges.issue(
        req.user.userId,
        email,
        'primary_rotation',
      );
      return { sent: true, expiresAt: expiresAt.toISOString() };
    } catch (err) {
      throw this.recoveryFailure(req.user.userId, 'primary_challenge', err);
    }
  }

  @Post('recovery/primary/verify')
  @AllowEntry()
  async verifyPrimaryRotationCode(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(VerifyRecoveryCodeSchema))
    body: VerifyRecoveryCodeDto,
  ) {
    try {
      const { grantId, expiresAt } = await this.challenges.verify(
        req.user.userId,
        'primary_rotation',
        body.code,
      );
      return { grantId, expiresAt: expiresAt.toISOString() };
    } catch (err) {
      throw this.recoveryFailure(req.user.userId, 'primary_verify', err);
    }
  }

  /**
   * Verifies the fresh passkey and stages the swap that puts its wallet in
   * the signer set. See {@link PrimaryRotationService}.
   */
  @Post('recovery/primary/start')
  @AllowEntry()
  async startPrimaryRotation(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(StartPrimaryRotationSchema))
    body: StartPrimaryRotationDto,
  ) {
    try {
      return await this.primaryRotations.start(
        req.user.userId,
        body.grantId,
        body.privyIdToken,
      );
    } catch (err) {
      if (err instanceof PasskeyInUseError) {
        throw new HttpException(
          { code: err.code, message: err.message },
          HttpStatus.CONFLICT,
        );
      }
      throw this.recoveryFailure(req.user.userId, 'primary_start', err);
    }
  }

  @Post('recovery/primary/next')
  @AllowEntry()
  async nextPrimaryRotationStep(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(NextDeviceRotationSchema))
    body: NextDeviceRotationDto,
  ) {
    try {
      return await this.primaryRotations.next(req.user.userId, body.grantId);
    } catch (err) {
      throw this.recoveryFailure(req.user.userId, 'primary_next', err);
    }
  }

  @Post('recovery/primary/submit')
  @AllowEntry()
  async submitPrimaryRotationStep(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(SubmitRecoveryChangeSchema))
    body: SubmitRecoveryChangeDto,
  ) {
    try {
      return {
        signature: await this.primaryRotations.submit(
          req.user.userId,
          body.signedTxBase64,
        ),
      };
    } catch (err) {
      throw this.recoveryFailure(req.user.userId, 'primary_submit', err);
    }
  }

  /**
   * Logs why a recovery key operation failed, then maps it.
   *
   * `toHttp` flattens anything it does not recognise into "Could not create
   * the Account", which is the right thing to hand a Consumer and useless to
   * us: a constraint violation, an RPC timeout and a Turnkey refusal all
   * arrive looking identical. The cause is written down before it is thrown
   * away.
   */
  private recoveryFailure(
    userId: string,
    operation: string,
    err: unknown,
  ): HttpException {
    this.logger.error(
      `account.recovery_failed userId=${userId} op=${operation}: ${describeError(err)}`,
    );
    return toHttp(err);
  }

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
      throw new DeviceNotAttestedError(
        'this device has no attested key for this account; enrol with an attestation',
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
  @AllowEntry()
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
      // Set while a device rotation is waiting out the time lock, so the app
      // knows to land it rather than asking the Consumer to start again.
      pendingApprovalSigner: account.pendingApprovalSigner ?? null,
      // Set while a passkey replacement waits out the lock, so the app can
      // land the execute step instead of asking the Consumer to start over.
      pendingPrimarySigner: account.pendingPrimarySigner ?? null,
      // Lets the app tell whether the key on this phone is the Account's, not
      // merely that some key exists. A phone holding another account's key can
      // approve nothing here.
      deviceKey: await this.turnkey.enrolledDeviceKey(account.approvalSubOrgId),
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
  // A wrong or spent code is the Consumer's to act on, and each answer means
  // something different: try again, wait, or start over.
  if (
    err instanceof InvalidRecoveryCodeError ||
    err instanceof NoRecoveryChallengeError
  ) {
    return new HttpException(
      { code: err.code, message: err.message },
      HttpStatus.UNAUTHORIZED,
    );
  }
  if (err instanceof TooManyRecoveryCodesError) {
    return new HttpException(
      { code: err.code, message: err.message },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
  if (
    err instanceof ChallengeAttemptsExhaustedError ||
    err instanceof RecoveryGrantExpiredError ||
    err instanceof NoRotationInFlightError
  ) {
    return new HttpException(
      { code: err.code, message: err.message },
      HttpStatus.CONFLICT,
    );
  }
  // Support's refusal, not the Consumer's mistake. Forbidden rather than a
  // conflict: nothing they retry changes the answer, only a call to support.
  if (err instanceof RecoveryReleaseFrozenError) {
    return new HttpException(
      { code: err.code, message: err.message },
      HttpStatus.FORBIDDEN,
    );
  }
  if (
    err instanceof LastRecoverySignerError ||
    err instanceof RecoverySignerLimitError ||
    err instanceof DuplicateRecoveryChannelError ||
    err instanceof RecoveryChangeInFlightError ||
    err instanceof ContactRecoverySignerError ||
    err instanceof ContactEmailTakenError
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

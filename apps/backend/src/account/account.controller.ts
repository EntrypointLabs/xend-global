import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
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
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { EnrolAccountSchema, type EnrolAccountDto } from './dtos';

interface AuthenticatedRequest extends Request {
  user: { userId: string; walletAddress: string };
}

@Controller('account')
@UseGuards(AuthGuard('jwt'))
export class AccountController {
  constructor(
    private readonly accounts: AccountService,
    private readonly attestation: AttestationService,
  ) {}

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
        recoverySigner: body.recoverySigner,
        hardwarePublicKey: verified.hardwarePublicKey,
      });

      return {
        address: account.vaultAddress,
        security: verified.security,
      };
    } catch (err) {
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
    };
  }
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

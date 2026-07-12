import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { AuthService, CredentialConflictError } from './auth.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  ExchangeRequestSchema,
  MirrorPasskeyCredentialSchema,
  type ExchangeRequest,
  type MirrorPasskeyCredentialRequest,
} from './dtos';

interface AuthenticatedRequest extends Request {
  user: { userId: string; walletAddress: string };
}

@Controller()
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('auth/exchange')
  exchange(
    @Body(new ZodValidationPipe(ExchangeRequestSchema)) dto: ExchangeRequest,
  ) {
    return this.auth.exchange(dto.privyIdToken);
  }

  /**
   * Mirror a freshly enrolled passkey credential for the authenticated
   * Consumer. Cross-account credential claims map to 409 CREDENTIAL_CONFLICT.
   */
  @Post('auth/passkey-credentials')
  @UseGuards(AuthGuard('jwt'))
  async mirrorPasskeyCredential(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(MirrorPasskeyCredentialSchema))
    dto: MirrorPasskeyCredentialRequest,
  ) {
    try {
      return await this.auth.mirrorPasskeyCredential(req.user.userId, dto);
    } catch (err) {
      if (err instanceof CredentialConflictError) {
        throw new HttpException(
          { code: err.code, message: err.message },
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
  }
}

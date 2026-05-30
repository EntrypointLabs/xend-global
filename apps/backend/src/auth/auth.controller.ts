import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SessionSecrets, MetaInfo, GridClientUserContext } from '@sqds/grid';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ExchangeRequestSchema, type ExchangeRequest } from './dtos';

class RegisterDto {
  email: string;
}

class VerifyOtpAndCreateAccountDto {
  otpCode: string;
  sessionSecrets: SessionSecrets;
  user: GridClientUserContext;
}

class AuthenticateDto {
  email: string;
}

class VerifyOtpDto {
  otpCode: string;
  sessionSecrets: SessionSecrets;
  user: GridClientUserContext;
}

class CheckPasskeysDto {
  accountAddress: string;
}

class CreatePasskeySessionDto {
  accountAddress: string;
  metaInfo: MetaInfo;
}

@Controller()
export class AuthController {
  constructor(private auth: AuthService) {}

  // Phase 1: Privy ID-token exchange. Replaces the /register +
  // /verify-otp-and-create-account chain. The legacy endpoints below
  // stay alive until the Phase 4 mobile cutover lands (then Phase 5
  // deletes them).
  @Post('auth/exchange')
  exchange(
    @Body(new ZodValidationPipe(ExchangeRequestSchema)) dto: ExchangeRequest,
  ) {
    return this.auth.exchange(dto.privyIdToken);
  }

  // Registration — matches mobile EasClient POST /register
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto.email);
  }

  // Registration step 2 — matches mobile EasClient POST /verify-otp-and-create-account
  @Post('verify-otp-and-create-account')
  verifyOtpAndCreateAccount(@Body() dto: VerifyOtpAndCreateAccountDto) {
    return this.auth.verifyOtpAndCreateAccount(dto);
  }

  // Login — matches mobile EasClient POST /auth
  @Post('auth')
  authenticate(@Body() dto: AuthenticateDto) {
    return this.auth.authenticate(dto.email);
  }

  // Login step 2 — matches mobile EasClient POST /verify-otp
  @Post('verify-otp')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto);
  }

  // Passkey — check if account has passkeys
  @Post('passkeys/check')
  checkPasskeys(@Body() dto: CheckPasskeysDto) {
    return this.auth.checkPasskeys(dto.accountAddress);
  }

  // Passkey — create a passkey session (returns hosted URL)
  @Post('passkeys/session')
  createPasskeySession(@Body() dto: CreatePasskeySessionDto) {
    return this.auth.createPasskeySession(dto);
  }
}

import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SessionSecrets, MetaInfo, GridClientUserContext } from '@sqds/grid';

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

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto.email);
  }

  @Post('verify-otp-and-create-account')
  verifyOtpAndCreateAccount(@Body() dto: VerifyOtpAndCreateAccountDto) {
    return this.auth.verifyOtpAndCreateAccount(dto);
  }

  @Post('auth')
  authenticate(@Body() dto: AuthenticateDto) {
    return this.auth.authenticate(dto.email);
  }

  @Post('verify-otp')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto);
  }

  @Post('passkeys/check')
  checkPasskeys(@Body() dto: CheckPasskeysDto) {
    return this.auth.checkPasskeys(dto.accountAddress);
  }

  @Post('passkeys/session')
  createPasskeySession(@Body() dto: CreatePasskeySessionDto) {
    return this.auth.createPasskeySession(dto);
  }
}

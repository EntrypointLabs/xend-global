import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SessionSecrets } from '@sqds/grid';

class RegisterDto {
    email: string;
}

class VerifyOtpAndCreateAccountDto {
    otpCode:        string;
    sessionSecrets: SessionSecrets;
    user:           any;
}

class AuthenticateDto {
    email: string;
}

class VerifyOtpDto {
    otpCode:        string;
    sessionSecrets: SessionSecrets;
    user:           any;
}

@Controller()
export class AuthController {
    constructor(private auth: AuthService) {}

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
}
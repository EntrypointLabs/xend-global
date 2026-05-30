import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ExchangeRequestSchema, type ExchangeRequest } from './dtos';

/**
 * AuthController — Phase 5 reduced to a single endpoint: `POST /auth/exchange`.
 *
 * The legacy Grid-shaped routes (`/register`, `/auth`, `/verify-otp`,
 * `/verify-otp-and-create-account`, `/passkeys/check`, `/passkeys/session`)
 * were deleted along with the BFF that called them.
 */
@Controller()
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('auth/exchange')
  exchange(
    @Body(new ZodValidationPipe(ExchangeRequestSchema)) dto: ExchangeRequest,
  ) {
    return this.auth.exchange(dto.privyIdToken);
  }
}

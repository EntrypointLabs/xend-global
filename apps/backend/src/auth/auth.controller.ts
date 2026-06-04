import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ExchangeRequestSchema, type ExchangeRequest } from './dtos';

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

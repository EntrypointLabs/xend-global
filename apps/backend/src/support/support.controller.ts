import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AllowEntry } from '../auth/allow-entry.decorator';
import { ConsumerAuthGuard } from '../auth/consumer-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  CreateSupportRequestSchema,
  type CreateSupportRequest,
  type CreateSupportRequestResponse,
} from './dtos';
import { SupportRateLimitedError } from './support.errors';
import { SupportService } from './support.service';

interface AuthenticatedRequest extends Request {
  user: { userId: string; walletAddress: string };
}

/**
 * Error mapping:
 *   SupportRateLimitedError -> 429 SUPPORT_RATE_LIMITED
 *
 * Open to entry sessions. A Consumer locked out of their Account has nothing
 * but an email-only session to ask from, and the security notices they are
 * sent tell them to contact support from the app.
 */
@Controller('support')
@UseGuards(ConsumerAuthGuard)
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post('requests')
  @AllowEntry()
  async create(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(CreateSupportRequestSchema))
    dto: CreateSupportRequest,
  ): Promise<CreateSupportRequestResponse> {
    try {
      return await this.support.create(req.user.userId, dto);
    } catch (err) {
      if (err instanceof SupportRateLimitedError) {
        throw new HttpException(
          { code: err.code, message: err.message },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw err;
    }
  }
}

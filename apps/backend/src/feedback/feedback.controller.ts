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
import { ConsumerAuthGuard } from '../auth/consumer-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  CreateFeedbackSchema,
  type CreateFeedback,
  type CreateFeedbackResponse,
} from './dtos';
import { FeedbackRateLimitedError } from './feedback.errors';
import { FeedbackService } from './feedback.service';

interface AuthenticatedRequest extends Request {
  user: { userId: string; walletAddress: string };
}

/**
 * Error mapping:
 *   FeedbackRateLimitedError -> 429 FEEDBACK_RATE_LIMITED
 *
 * Closed to entry sessions, unlike a support request. That one is open
 * because a Consumer who is locked out has to be able to ask for help, and
 * nobody is locked out of giving feedback.
 */
@Controller('feedback')
@UseGuards(ConsumerAuthGuard)
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post()
  async create(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(CreateFeedbackSchema)) dto: CreateFeedback,
  ): Promise<CreateFeedbackResponse> {
    try {
      return await this.feedback.create(req.user.userId, dto);
    } catch (err) {
      if (err instanceof FeedbackRateLimitedError) {
        throw new HttpException(
          { code: err.code, message: err.message },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw err;
    }
  }
}

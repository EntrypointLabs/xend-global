import {
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { SessionService } from './session.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  RevokeSessionParamsSchema,
  type ListSessionsResponse,
  type RevokeSessionParams,
} from './dtos';
import { SessionNotFoundError } from './session.errors';

interface AuthenticatedRequest extends Request {
  user: { userId: string; walletAddress: string };
}

/**
 * Consumer-facing Session surface. The consumer JWT is the correct guard
 * here (this is an app surface); merchant auth primitives stay separate.
 *
 * Error mapping:
 *   SessionNotFoundError -> 404 SESSION_NOT_FOUND
 */
@Controller('consumers/me/sessions')
@UseGuards(AuthGuard('jwt'))
export class SessionController {
  constructor(private readonly sessions: SessionService) {}

  @Get()
  async list(@Req() req: AuthenticatedRequest): Promise<ListSessionsResponse> {
    const sessions = await this.sessions.listForConsumer(req.user.userId);
    return { sessions };
  }

  @Delete(':id')
  async revoke(
    @Req() req: AuthenticatedRequest,
    @Param(new ZodValidationPipe(RevokeSessionParamsSchema))
    params: RevokeSessionParams,
  ): Promise<{ revoked: true }> {
    try {
      await this.sessions.revoke(req.user.userId, params.id);
      return { revoked: true };
    } catch (err) {
      this.mapServiceError(err);
    }
  }

  private mapServiceError(err: unknown): never {
    if (err instanceof SessionNotFoundError) {
      throw new HttpException(
        { code: err.code, message: err.message },
        HttpStatus.NOT_FOUND,
      );
    }
    throw err as Error;
  }
}

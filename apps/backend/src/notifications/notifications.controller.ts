import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import {
  ForgetDeviceSchema,
  NotificationPreferenceSchema,
  RegisterDeviceSchema,
} from './dtos';
import type {
  ForgetDeviceRequest,
  NotificationPreferenceRequest,
  NotificationPreferenceResponse,
  RegisterDeviceRequest,
} from './dtos';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { NotificationsService } from './notifications.service';

interface AuthenticatedRequest extends Request {
  user: { userId: string; walletAddress: string };
}

/**
 * Where a Consumer's notifications go, and whether they want them.
 *
 * No endpoint reads a token back out. A token addresses somebody's device, and
 * nothing in the app needs to see one to work.
 */
@Controller('notifications')
@UseGuards(AuthGuard('jwt'))
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post('devices')
  @HttpCode(HttpStatus.NO_CONTENT)
  async registerDevice(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(RegisterDeviceSchema))
    { token, platform }: RegisterDeviceRequest,
  ): Promise<void> {
    await this.notifications.registerDevice({
      userId: req.user.userId,
      token,
      platform,
    });
  }

  /**
   * Called on sign-out. Without it the device keeps its registration and the
   * next arrival for the Consumer who signed out lights up a phone that now
   * belongs to whoever holds it — the preference is per person, so the new
   * signed-out state silences nothing.
   */
  @Delete('devices')
  @HttpCode(HttpStatus.NO_CONTENT)
  async forgetDevice(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(ForgetDeviceSchema))
    { token }: ForgetDeviceRequest,
  ): Promise<void> {
    await this.notifications.forgetDevice(req.user.userId, token);
  }

  @Get('preferences')
  async getPreference(
    @Req() req: AuthenticatedRequest,
  ): Promise<NotificationPreferenceResponse> {
    return { enabled: await this.notifications.isEnabled(req.user.userId) };
  }

  @Put('preferences')
  async setPreference(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(NotificationPreferenceSchema))
    { enabled }: NotificationPreferenceRequest,
  ): Promise<NotificationPreferenceResponse> {
    await this.notifications.setEnabled(req.user.userId, enabled);
    return { enabled };
  }
}

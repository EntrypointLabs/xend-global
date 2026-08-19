import {
  Body,
  Controller,
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
import { NotificationPreferenceSchema, RegisterDeviceSchema } from './dtos';
import type { NotificationPreferenceResponse } from './dtos';
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
    @Body() body: unknown,
  ): Promise<void> {
    const { token, platform } = RegisterDeviceSchema.parse(body);
    await this.notifications.registerDevice({
      userId: req.user.userId,
      token,
      platform,
    });
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
    @Body() body: unknown,
  ): Promise<NotificationPreferenceResponse> {
    const { enabled } = NotificationPreferenceSchema.parse(body);
    await this.notifications.setEnabled(req.user.userId, enabled);
    return { enabled };
  }
}

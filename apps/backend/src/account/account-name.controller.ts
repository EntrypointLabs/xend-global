import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { ConsumerAuthGuard } from '../auth/consumer-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AccountEventsService } from '../activity/account-events.service';

export const RenameAccountSchema = z.object({
  name: z.string().trim().min(1).max(40),
  previous: z.string().trim().max(40).nullable(),
});
export type RenameAccountDto = z.infer<typeof RenameAccountSchema>;

interface AuthenticatedRequest extends Request {
  user: { userId: string; walletAddress: string };
}

/**
 * Records that the Consumer renamed their Account, so it shows in Activity.
 *
 * The name itself lives on the device. This only writes the event, deduped
 * on the pair of names, so a retry after a dropped response never shows the
 * same rename twice.
 */
@Controller('account')
@UseGuards(ConsumerAuthGuard)
export class AccountNameController {
  constructor(private readonly events: AccountEventsService) {}

  @Post('name')
  @HttpCode(204)
  async rename(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(RenameAccountSchema)) body: RenameAccountDto,
  ): Promise<void> {
    if (body.previous === body.name) return;
    await this.events.recordWalletRenamed(req.user.userId, {
      name: body.name,
      previous: body.previous,
    });
  }
}

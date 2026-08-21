import { Module } from '@nestjs/common';
import { ExpoPushAdapter } from './expo-push.adapter';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PUSH_SENDER } from './push-sender.interface';

@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    ExpoPushAdapter,
    { provide: PUSH_SENDER, useClass: ExpoPushAdapter },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}

import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { ExpoPushAdapter } from './expo-push.adapter';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PUSH_SENDER } from './push-sender.interface';
import { SecurityNoticeService } from './security-notice.service';

@Module({
  imports: [MailModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    SecurityNoticeService,
    ExpoPushAdapter,
    { provide: PUSH_SENDER, useClass: ExpoPushAdapter },
  ],
  exports: [NotificationsService, SecurityNoticeService],
})
export class NotificationsModule {}

import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import {
  DrizzleSupportRequestStore,
  SUPPORT_REQUEST_STORE,
} from './support-request.store';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

@Module({
  // MailModule provides the mailer a request is copied to the team with. The
  // service is exported for the ops console, which closes requests.
  imports: [MailModule],
  controllers: [SupportController],
  providers: [
    { provide: SUPPORT_REQUEST_STORE, useClass: DrizzleSupportRequestStore },
    SupportService,
  ],
  exports: [SupportService],
})
export class SupportModule {}

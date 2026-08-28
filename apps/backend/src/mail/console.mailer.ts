import { Injectable, Logger } from '@nestjs/common';
import type { Mailer, OutgoingMail } from './mail.interface';

/**
 * Writes mail to the log instead of sending it.
 *
 * What a developer uses to walk the recovery flow on a real device before a
 * provider key exists: the code is in the backend output, and the flow it
 * gates is otherwise identical. Refused outside development, because a
 * deployment that silently stops mailing recovery codes looks healthy right up
 * until somebody needs one.
 */
@Injectable()
export class ConsoleMailer implements Mailer {
  private readonly logger = new Logger(ConsoleMailer.name);

  send(mail: OutgoingMail): Promise<void> {
    this.logger.warn(
      `mail.console to=${mail.to} subject=${JSON.stringify(mail.subject)}\n${mail.text}`,
    );
    return Promise.resolve();
  }
}

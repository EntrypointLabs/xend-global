import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Mailer, OutgoingMail } from './mail.interface';

const ENDPOINT = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10_000;

export class MailDeliveryError extends Error {
  readonly code = 'MAIL_DELIVERY_FAILED';
  constructor(message: string) {
    super(message);
    this.name = 'MailDeliveryError';
  }
}

/**
 * Resend over its REST API rather than its SDK.
 *
 * One POST with a bearer token is the whole integration, and a dependency that
 * exists to build that request would be another package in the tree for every
 * deployment, including the ones that never send mail.
 */
@Injectable()
export class ResendMailer implements Mailer {
  private readonly logger = new Logger(ResendMailer.name);

  constructor(private readonly config: ConfigService) {}

  async send(mail: OutgoingMail): Promise<void> {
    const apiKey = this.config.getOrThrow<string>('RESEND_API_KEY');
    const from = this.config.getOrThrow<string>('MAIL_FROM');

    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [mail.to],
          subject: mail.subject,
          text: mail.text,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (cause) {
      // The address never reaches the log. A failure to mail is diagnosable
      // from the status and our own request, and the recipient is the one
      // thing here that is the Consumer's.
      this.logger.error('mail.send_failed transport', cause);
      throw new MailDeliveryError('could not reach the mail provider');
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error(
        `mail.send_failed status=${response.status} ${detail.slice(0, 200)}`,
      );
      throw new MailDeliveryError(`mail provider answered ${response.status}`);
    }

    this.logger.log('mail.sent');
  }
}

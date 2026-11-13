import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SupportTopic } from '../db/schema';
import { MAILER, type Mailer } from '../mail/mail.interface';
import type {
  CreateSupportRequest,
  CreateSupportRequestResponse,
} from './dtos';
import {
  SUPPORT_REQUEST_STORE,
  type CloseOutcome,
  type NewSupportRequest,
  type SupportRequester,
  type SupportRequestStore,
} from './support-request.store';
import { SupportRateLimitedError } from './support.errors';

const MAX_REQUESTS_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

const TOPIC_LABELS: Record<SupportTopic, string> = {
  account_access: 'Account access',
  payments: 'Payments',
  earn_swap: 'Earn and Swap',
  other: 'Other',
};

/**
 * Takes what a Consumer writes to the team from the app.
 *
 * The stored row is the request. A copy is mailed to the support inbox when
 * the deployment names one, with the Consumer's own address as reply-to so
 * answering the mail answers them, but nothing depends on that copy arriving.
 */
@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);
  private readonly inbox: string;

  constructor(
    config: ConfigService,
    @Inject(SUPPORT_REQUEST_STORE) private readonly store: SupportRequestStore,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {
    this.inbox = config.get<string>('SUPPORT_INBOX_EMAIL') ?? '';
  }

  async create(
    userId: string,
    request: CreateSupportRequest,
    now = new Date(),
  ): Promise<CreateSupportRequestResponse> {
    const requester = await this.store.findRequester(userId);
    const stored: NewSupportRequest = {
      userId,
      topic: request.topic,
      message: request.message,
      contactEmail: requester.email,
      appVersion: request.appVersion ?? null,
      platform: request.platform ?? null,
      createdAt: now,
    };

    const id = await this.store.oneAtATime(userId, async () => {
      const recent = await this.store.countSince(
        userId,
        new Date(now.getTime() - HOUR_MS),
      );
      if (recent >= MAX_REQUESTS_PER_HOUR) throw new SupportRateLimitedError();
      return this.store.insert(stored);
    });
    this.logger.log(
      `support.request.stored id=${id} user_id=${userId} topic=${request.topic}`,
    );

    await this.forward(id, stored, requester);
    return { id, replyTo: requester.email };
  }

  /** The team's to call, from the console. No Consumer route reaches it. */
  close(id: string, now = new Date()): Promise<CloseOutcome> {
    return this.store.close(id, now);
  }

  /**
   * Never throws. The request is already stored and already in the console,
   * so a mail outage must not tell the Consumer their request was lost.
   */
  private async forward(
    id: string,
    request: NewSupportRequest,
    requester: SupportRequester,
  ): Promise<void> {
    if (!this.inbox) return;
    try {
      await this.mailer.send({
        to: this.inbox,
        subject: `Support request: ${TOPIC_LABELS[request.topic]}`,
        // What we know comes first and the message last, so nothing the
        // Consumer typed can pass for one of the lines above it.
        text: [
          `Request: ${id}`,
          `Consumer: ${request.userId}`,
          `Email: ${requester.email ?? 'none on the Account'}`,
          `Account: ${requester.accountAddress ?? 'none'}`,
          `App version: ${request.appVersion ?? 'not given'}`,
          `Platform: ${request.platform ?? 'not given'}`,
          '',
          'Message:',
          request.message,
        ].join('\n'),
        ...(requester.email ? { replyTo: requester.email } : {}),
      });
      this.logger.log(`support.request.mailed id=${id}`);
    } catch (err) {
      this.logger.warn(`support.request.mail_failed id=${id}`, err);
    }
  }
}

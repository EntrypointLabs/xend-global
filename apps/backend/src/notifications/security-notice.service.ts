import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';

import { DbService } from '../db/db.service';
import { pushDevices, users, type AccountEventKind } from '../db/schema';
import { MAILER, type Mailer } from '../mail/mail.interface';
import { NOTICE_KIND, PUSH_SENDER } from './push-sender.interface';
import type { NoticeKind, PushSender } from './push-sender.interface';

/** What a staged settings change is, when the service that staged it knows. */
export type StagedChangeKind =
  | 'recovery_key'
  | 'device'
  | 'contact_email'
  | 'passkey';

export interface SecurityEvent {
  userId: string;
  kind: AccountEventKind;
  subject: string | null;
  previousSubject: string | null;
  occurredAt: Date;
}

export interface NoticeContext {
  change?: StagedChangeKind;
}

interface MailDraft {
  /** An explicit inbox. Absent, the Account's contact address. */
  to?: string;
  subject: string;
  text: string;
}

interface Notice {
  push: { title: string; body: string; kind: NoticeKind };
  mails: MailDraft[];
}

const NOT_YOU_PENDING =
  'If it was not you, open Xend now, review the pending change and reject it. Then contact support from the app.';
const NOT_YOU_DONE =
  'If this was not you, contact support from the app right away.';

/**
 * Tells a Consumer that something happened to their Account itself.
 *
 * A separate path from arrival notices on purpose. `users.notifications_enabled`
 * is the Consumer's answer to "tell me when money arrives", and nothing here
 * reads it: the one notice that has to arrive is the one about a change they
 * did not make, and a quiet preference must not be able to silence it. The
 * device list is read straight from `push_devices` so the preference cannot
 * be joined in by accident.
 *
 * Push is the channel that matters. In the compromise this defends against
 * the inbox belongs to the attacker, so the phone is what has to hear. Email
 * still goes out, because it reaches a Consumer who is not holding the phone
 * and it is the record they forward to support, but nothing waits on it.
 *
 * Never throws. Every caller is in the middle of recording something that
 * already happened, and failing to mention it must not undo it.
 */
@Injectable()
export class SecurityNoticeService {
  private readonly logger = new Logger(SecurityNoticeService.name);

  constructor(
    private readonly db: DbService,
    @Inject(PUSH_SENDER) private readonly push: PushSender,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  async deliver(
    event: SecurityEvent,
    context: NoticeContext = {},
  ): Promise<void> {
    const notice = compose(event, context);
    if (!notice) return;

    await this.pushToEveryDevice(event, notice.push);
    for (const draft of notice.mails) {
      await this.mail(event, draft);
    }
  }

  private async pushToEveryDevice(
    event: SecurityEvent,
    message: Notice['push'],
  ): Promise<void> {
    try {
      const devices = await this.db.client
        .select({ token: pushDevices.token })
        .from(pushDevices)
        .where(eq(pushDevices.userId, event.userId));
      if (devices.length === 0) {
        this.logger.warn(
          `security_notice.push_undeliverable userId=${event.userId} kind=${event.kind}`,
        );
        return;
      }

      const { invalidTokens } = await this.push.send(
        devices.map((device) => ({
          token: device.token,
          title: message.title,
          body: message.body,
          data: { kind: message.kind },
        })),
      );
      this.logger.log(
        `security_notice.pushed userId=${event.userId} kind=${event.kind} devices=${devices.length}`,
      );

      if (invalidTokens.length > 0) {
        await this.db.client
          .delete(pushDevices)
          .where(inArray(pushDevices.token, invalidTokens));
      }
    } catch (err) {
      this.logger.warn(
        `security_notice.push_failed userId=${event.userId} kind=${event.kind}`,
        err,
      );
    }
  }

  private async mail(event: SecurityEvent, draft: MailDraft): Promise<void> {
    try {
      const to = draft.to ?? (await this.contactAddress(event.userId));
      if (!to) {
        this.logger.warn(
          `security_notice.no_email userId=${event.userId} kind=${event.kind}`,
        );
        return;
      }
      await this.mailer.send({ to, subject: draft.subject, text: draft.text });
      // The address never reaches the log.
      this.logger.log(
        `security_notice.mailed userId=${event.userId} kind=${event.kind}`,
      );
    } catch (err) {
      this.logger.warn(
        `security_notice.mail_failed userId=${event.userId} kind=${event.kind}`,
        err,
      );
    }
  }

  private async contactAddress(userId: string): Promise<string | null> {
    const [row] = await this.db.client
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.email ?? null;
  }
}

/**
 * The words for each kind, or null for the kinds that do not notify.
 *
 * Written out per kind rather than assembled, because these are the sentences
 * somebody reads to work out whether their account was touched without them.
 */
function compose(event: SecurityEvent, context: NoticeContext): Notice | null {
  const when = formatWhen(event.occurredAt);
  const subject = event.subject;
  const previous = event.previousSubject;

  switch (event.kind) {
    case 'settings_change_staged':
      return staged(context.change, subject, when);

    case 'settings_change_rejected':
      return {
        push: {
          title: 'A change to your account was rejected',
          body: 'Nothing changed.',
          kind: NOTICE_KIND.securityAlert,
        },
        mails: [
          {
            subject: 'A change to your Xend account was rejected',
            text: lines(
              `A pending change to your account was rejected at ${when}. Nothing about your account changed.`,
              'If you did not expect this, open Xend and check Keys and Recovery.',
            ),
          },
        ],
      };

    case 'recovery_key_added':
      return {
        push: {
          title: 'Recovery key added',
          body: `${subject} can now help move your account to a new phone.`,
          kind: NOTICE_KIND.securityAlert,
        },
        mails: [
          {
            subject: 'A recovery key was added to your Xend account',
            text: lines(
              `${subject} was added as a recovery key on your account at ${when}. It can help move your account to a new phone.`,
              'If this was not you, open Xend, remove it under Keys and Recovery, and contact support from the app.',
            ),
          },
        ],
      };

    case 'recovery_key_removed':
      return {
        push: {
          title: 'Recovery key removed',
          body: `${subject} can no longer help move your account to a new phone.`,
          kind: NOTICE_KIND.securityAlert,
        },
        mails: [
          {
            subject: 'A recovery key was removed from your Xend account',
            text: lines(
              `${subject} was removed as a recovery key on your account at ${when}.`,
              NOT_YOU_DONE,
            ),
          },
        ],
      };

    case 'recovery_key_rotated':
      return {
        push: {
          title: 'Recovery key changed',
          body: previous
            ? `${previous} was replaced by ${subject}.`
            : `It now uses ${subject}.`,
          kind: NOTICE_KIND.securityAlert,
        },
        mails: [
          {
            subject: 'A recovery key on your Xend account changed',
            text: lines(
              previous
                ? `A recovery key on your account changed at ${when}: ${previous} was replaced by ${subject}.`
                : `A recovery key on your account changed at ${when} to ${subject}.`,
              NOT_YOU_DONE,
            ),
          },
        ],
      };

    case 'device_rotated':
      return {
        push: {
          title: 'Your account moved to a new phone',
          body: 'The phone you used before can no longer approve payments. If this was not you, contact support.',
          kind: NOTICE_KIND.securityAlert,
        },
        mails: [
          {
            subject: 'Your Xend account moved to a new phone',
            text: lines(
              `Your account moved to a new phone at ${when}. The phone you used before can no longer approve payments.`,
              NOT_YOU_DONE,
            ),
          },
        ],
      };

    case 'contact_email_changed': {
      // The old inbox is where the alarm has to land: it is the one that
      // stops hearing about the account. The new one only confirms.
      const mails: MailDraft[] = [];
      if (previous) {
        mails.push({
          to: previous,
          subject: 'Your Xend contact email has changed',
          text: lines(
            `The contact email for your Xend account changed from ${previous} to ${subject} at ${when}. This address will not get notices about the account from now on.`,
            'If this was not you, contact Xend support right away.',
          ),
        });
      }
      if (subject) {
        mails.push({
          to: subject,
          subject: 'This is now the contact email for your Xend account',
          text: lines(
            `This address became the contact email for your Xend account at ${when}. Notices about the account come here from now on.`,
            NOT_YOU_DONE,
          ),
        });
      }
      return {
        push: {
          title: 'Your contact email changed',
          body: `Notices about your account now go to ${subject}.`,
          kind: NOTICE_KIND.securityAlert,
        },
        mails,
      };
    }

    case 'passkey_enrolled':
      return {
        push: {
          title: 'A passkey was added to your account',
          body: 'It can now be used to open Xend as you. If this was not you, contact support.',
          kind: NOTICE_KIND.securityAlert,
        },
        mails: [
          {
            subject: 'A passkey was added to your Xend account',
            text: lines(
              `A new passkey was added to your account at ${when}. It can be used to open Xend as you.`,
              NOT_YOU_DONE,
            ),
          },
        ],
      };

    case 'spending_limit_changed':
      return {
        push: {
          title: 'Your spending limit changed',
          body: subject ? `It is now ${subject}.` : 'Open Xend to check it.',
          kind: NOTICE_KIND.securityAlert,
        },
        mails: [
          {
            subject: 'Your Xend spending limit changed',
            text: lines(
              `Your spending limit changed at ${when}${subject ? ` to ${subject}` : ''}${previous ? ` (it was ${previous})` : ''}.`,
              'If this was not you, open Xend, check it under Spending limits, and contact support from the app.',
            ),
          },
        ],
      };

    // Execution is announced by the event that says what executed, recorded
    // by the same settle: a key added, a phone swapped, an address moved. The
    // executed row is the receipt for the change itself. A wallet's name is
    // not a security matter and stays under the arrival preference.
    case 'settings_change_executed':
    case 'wallet_renamed':
      return null;
  }
}

function staged(
  change: StagedChangeKind | undefined,
  subject: string | null,
  when: string,
): Notice {
  const push = ((): Notice['push'] => {
    const kind = NOTICE_KIND.pendingChange;
    switch (change) {
      case 'recovery_key':
        return {
          title: 'Your recovery key change is on its way',
          body: 'It goes through after a 24 hour delay. Open Xend to review or cancel it.',
          kind,
        };
      case 'device':
        return {
          title: 'A new phone is being added to your account',
          body: 'It takes over after a 24 hour delay. If this was not you, open Xend and reject it.',
          kind,
        };
      case 'contact_email':
        return {
          title: 'Your contact email is changing',
          body: `It changes${subject ? ` to ${subject}` : ''} after a 24 hour delay. If this was not you, open Xend and reject it.`,
          kind,
        };
      case 'passkey':
        return {
          title: 'Your sign-in passkey is being replaced',
          body: 'The new one takes over after a 24 hour delay. If this was not you, open Xend and reject it.',
          kind,
        };
      default:
        return {
          title: 'Check your Xend account',
          body: 'Someone started a change to your account. If it was not you, open Xend and reject it.',
          kind,
        };
    }
  })();

  const what = ((): string => {
    switch (change) {
      case 'recovery_key':
        return subject
          ? `A change to your recovery keys (${subject}) was started`
          : 'A change to your recovery keys was started';
      case 'device':
        return 'A new phone started taking over your account';
      case 'contact_email':
        return subject
          ? `A change of your contact email to ${subject} was started`
          : 'A change of your contact email was started';
      case 'passkey':
        return 'A replacement of the passkey that signs you in was started';
      default:
        return 'Someone started a change to the security settings of your account';
    }
  })();

  return {
    push,
    mails: [
      {
        subject: 'A change to your Xend account has started',
        text: lines(
          `${what} at ${when}.`,
          'It goes through after a 24 hour delay. Until then it can be rejected from your phone.',
          'If this was you, there is nothing to do.',
          NOT_YOU_PENDING,
        ),
      },
    ],
  };
}

function lines(...paragraphs: string[]): string {
  return paragraphs.join('\n\n');
}

/** "30 Aug 2026, 14:05 UTC": absolute, because the mail may be read days later. */
function formatWhen(at: Date): string {
  return `${new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(at)} UTC`;
}

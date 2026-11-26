/**
 * Writes every mail template to disk as HTML and plain text, for previewing
 * in a browser and for pasting the waitlist announcement into a Resend
 * Broadcast.
 *
 *   npx ts-node scripts/render-emails.ts [outDir]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { renderCodeEmail } from '../src/mail/templates/code-email';
import { renderLaunchAnnouncement } from '../src/mail/templates/launch-announcement';
import { renderNoticeEmail } from '../src/mail/templates/notice-email';
import { compose } from '../src/notifications/security-notice.service';
import { CODE_EMAIL_COPY } from '../src/recovery/recovery-challenge.service';

const outDir = resolve(process.argv[2] ?? 'email-previews');
mkdirSync(outDir, { recursive: true });

const mails: Record<string, { html: string; text: string }> = {
  'launch-announcement': renderLaunchAnnouncement(),
};
for (const purpose of [
  'contact_verification',
  'contact_rotation',
  'entry_session',
  'device_rotation',
] as const) {
  mails[`code-${purpose}`] = renderCodeEmail({
    code: '482913',
    expiresInMinutes: 10,
    ...CODE_EMAIL_COPY[purpose],
  });
}

const occurredAt = new Date('2026-08-30T14:05:00Z');
const notices = [
  compose(
    {
      userId: 'preview',
      kind: 'settings_change_staged',
      subject: '$250 a day',
      previousSubject: null,
      occurredAt,
    },
    { change: 'spending_limit' },
  ),
  compose(
    {
      userId: 'preview',
      kind: 'device_rotated',
      subject: null,
      previousSubject: null,
      occurredAt,
    },
    {},
  ),
];
notices.forEach((notice, i) => {
  const draft = notice?.mails[0];
  if (!draft) return;
  mails[`notice-${i + 1}`] = {
    text: draft.text,
    html: renderNoticeEmail({
      title: draft.subject,
      paragraphs: draft.text.split('\n\n'),
    }),
  };
});

for (const [name, { html, text }] of Object.entries(mails)) {
  writeFileSync(join(outDir, `${name}.html`), html);
  writeFileSync(join(outDir, `${name}.txt`), text);
}
console.log(`wrote ${Object.keys(mails).length} mails to ${outDir}`);

import {
  BORDER,
  escapeHtml,
  INK,
  MUTED,
  MUTED_DARK,
  SANS,
  WHITE,
  mark,
  renderLayout,
} from './layout';

export const TESTFLIGHT_URL = 'https://testflight.apple.com/join/V4zsFUk4';

/**
 * Resend fills this in when the mail goes out as a Broadcast. Sent any other
 * way, the literal placeholder would reach the reader, so the waitlist mail
 * must go through Broadcasts.
 */
const UNSUBSCRIBE_URL = '{{{RESEND_UNSUBSCRIBE_URL}}}';

const FEATURES: Array<[string, string]> = [
  [
    'Hold dollars',
    'Your balance stays in dollars, shown in your own currency.',
  ],
  ['Send in seconds', 'To anyone, any time. Network fees are on us.'],
  [
    'Nothing to remember',
    'No password to forget. Your face or fingerprint is the key.',
  ],
];

export const LAUNCH_SUBJECT = "It's your turn: Prydd is ready on iPhone";

export function renderLaunchAnnouncement(): { html: string; text: string } {
  const featureRows = FEATURES.map(
    ([name, line], i) => `
                    <tr>
                      <td style="padding:16px 0;${i > 0 ? `border-top:1px solid ${BORDER};` : ''}font-family:${SANS};font-size:15px;line-height:22px;">
                        <span style="font-weight:600;color:${INK};">${escapeHtml(name)}</span><br>
                        <span style="color:${MUTED};">${escapeHtml(line)}</span>
                      </td>
                    </tr>`,
  ).join('');

  const body = `
              <tr>
                <td class="px" style="background-color:${INK};border-radius:16px 16px 0 0;padding:40px 40px 44px;">
                  ${mark(48)}
                  <h1 class="display" style="margin:40px 0 16px;font-family:${SANS};font-size:40px;line-height:46px;font-weight:600;letter-spacing:-1.2px;color:${WHITE};">It's your turn.</h1>
                  <p style="margin:0 0 32px;font-family:${SANS};font-size:17px;line-height:26px;color:${MUTED_DARK};">Prydd is on iPhone through TestFlight, Apple's app for early releases. Your dollar account is ready to open: an email, your face or fingerprint, and you're in.</p>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="background-color:${WHITE};border-radius:999px;">
                        <a href="${TESTFLIGHT_URL}" style="display:inline-block;padding:16px 28px;font-family:${SANS};font-size:16px;line-height:20px;font-weight:600;color:${INK};text-decoration:none;">Get Prydd for iPhone</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td class="px" style="padding:24px 40px 8px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${featureRows}
                  </table>
                </td>
              </tr>
              <tr>
                <td class="px" style="padding:16px 40px 40px;font-family:${SANS};font-size:15px;line-height:24px;color:${MUTED};">
                  <p style="margin:0 0 16px;">On Android? It's coming next, and you'll hear from us the day it lands.</p>
                  <p style="margin:0;color:${INK};">Thanks for waiting with us.<br>The Prydd team</p>
                </td>
              </tr>`;

  const html = renderLayout({
    title: LAUNCH_SUBJECT,
    preheader:
      'Your dollar account is ready to open. Get Prydd for iPhone on TestFlight.',
    body,
    footer: `You're getting this because you joined the Prydd waitlist at prydd.co.<br><a href="${UNSUBSCRIBE_URL}" style="color:${MUTED};text-decoration:underline;">Unsubscribe</a>`,
  });

  const text = [
    "It's your turn.",
    '',
    "Prydd is on iPhone through TestFlight, Apple's app for early releases. Your dollar account is ready to open: an email, your face or fingerprint, and you're in.",
    '',
    `Get Prydd for iPhone: ${TESTFLIGHT_URL}`,
    '',
    ...FEATURES.map(([name, line]) => `${name}. ${line}`),
    '',
    "On Android? It's coming next, and you'll hear from us the day it lands.",
    '',
    'Thanks for waiting with us.',
    'The Prydd team',
    '',
    "You're getting this because you joined the Prydd waitlist at prydd.co.",
    `Unsubscribe: ${UNSUBSCRIBE_URL}`,
  ].join('\n');

  return { html, text };
}

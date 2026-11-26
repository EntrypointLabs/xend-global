import {
  BORDER,
  escapeHtml,
  INK,
  MUTED,
  SANS,
  SITE_URL,
  paragraph,
  renderLayout,
} from './layout';

interface NoticeEmailInput {
  title: string;
  /**
   * The first says what happened and leads; the last says what to do about
   * it and is set apart below a rule, so the action is the last thing read.
   */
  paragraphs: string[];
}

export function renderNoticeEmail({
  title,
  paragraphs,
}: NoticeEmailInput): string {
  const [lead, ...rest] = paragraphs;
  const action = rest.length > 0 ? rest[rest.length - 1] : null;
  const middle = rest.slice(0, -1);

  const body = `
              <tr>
                <td class="px" style="padding:40px 40px 8px;">
                  <h1 style="margin:0 0 16px;font-family:${SANS};font-size:22px;line-height:28px;font-weight:600;letter-spacing:-0.4px;color:${INK};">${escapeHtml(title)}</h1>
                  ${paragraph(lead, INK)}
                  ${middle.map((line) => paragraph(line)).join('\n                  ')}
                </td>
              </tr>${
                action
                  ? `
              <tr>
                <td class="px" style="padding:0 40px 40px;">
                  <div style="border-top:1px solid ${BORDER};padding-top:20px;font-family:${SANS};font-size:14px;line-height:22px;font-weight:500;color:${INK};">${escapeHtml(action)}</div>
                </td>
              </tr>`
                  : `
              <tr><td style="padding:0 0 24px;"></td></tr>`
              }`;

  return renderLayout({
    title,
    preheader: lead,
    body,
    footer: `This is a security notice about your Prydd account. It is sent whatever your notification settings are.<br><a href="${SITE_URL}" style="color:${MUTED};text-decoration:underline;">prydd.co</a>`,
  });
}

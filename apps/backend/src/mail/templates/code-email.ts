import {
  BORDER,
  escapeHtml,
  INK,
  MONO,
  MUTED,
  PAPER,
  SANS,
  SITE_URL,
  mark,
  paragraph,
  renderLayout,
} from './layout';

export interface CodeEmailCopy {
  title: string;
  /** What entering the code does, said once, right above it. */
  lead: string;
  details: string[];
  /** What to do if the reader never asked for the code. */
  notMe: string;
}

interface CodeEmailInput extends CodeEmailCopy {
  code: string;
  expiresInMinutes: number;
}

export function renderCodeEmail(input: CodeEmailInput): {
  html: string;
  text: string;
} {
  const { code, expiresInMinutes, title, lead, details, notMe } = input;
  const expiry = `It expires in ${expiresInMinutes} minutes.`;

  const body = `
              <tr>
                <td class="px" style="padding:40px 40px 0;">${mark(40)}</td>
              </tr>
              <tr>
                <td class="px" style="padding:32px 40px 0;">
                  <h1 style="margin:0 0 12px;font-family:${SANS};font-size:26px;line-height:32px;font-weight:600;letter-spacing:-0.5px;color:${INK};">${escapeHtml(title)}</h1>
                  <p style="margin:0;font-family:${SANS};font-size:15px;line-height:24px;color:${MUTED};">${escapeHtml(lead)}</p>
                </td>
              </tr>
              <tr>
                <td class="px" style="padding:28px 40px 0;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td align="center" style="background-color:${PAPER};border-radius:12px;padding:28px 16px 24px;">
                        <div class="code" style="font-family:${MONO};font-size:44px;line-height:52px;font-weight:500;letter-spacing:12px;padding-left:12px;color:${INK};font-variant-numeric:tabular-nums;">${escapeHtml(code)}</div>
                        <div style="margin-top:8px;font-family:${SANS};font-size:13px;line-height:20px;color:${MUTED};">${escapeHtml(expiry)}</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td class="px" style="padding:28px 40px 8px;">
                  ${details.map((line) => paragraph(line)).join('\n                  ')}
                </td>
              </tr>
              <tr>
                <td class="px" style="padding:0 40px 40px;">
                  <div style="border-top:1px solid ${BORDER};padding-top:20px;font-family:${SANS};font-size:13px;line-height:20px;color:${MUTED};">
                    <strong style="font-weight:600;color:${INK};">Didn't ask for this?</strong> ${escapeHtml(notMe)}
                  </div>
                </td>
              </tr>`;

  const html = renderLayout({
    title,
    preheader: `${code} · ${expiry}`,
    body,
    footer: `Prydd. Money, but faster.<br><a href="${SITE_URL}" style="color:${MUTED};text-decoration:underline;">prydd.co</a>`,
  });

  const text = [
    `${title}: ${code}`,
    '',
    lead,
    expiry,
    '',
    ...details.flatMap((line) => [line, '']),
    `Didn't ask for this? ${notMe}`,
  ].join('\n');

  return { html, text };
}

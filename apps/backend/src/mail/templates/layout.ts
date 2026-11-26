export const INK = '#0A0A0A';
export const PAPER = '#F5F5F5';
export const WHITE = '#FFFFFF';
export const MUTED = '#6B6B6B';
export const MUTED_DARK = '#9BA1A6';
export const BORDER = '#E6E6E6';

export const SANS =
  "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
export const MONO =
  "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/**
 * Hosted rather than embedded: most clients block data URIs and CID
 * attachments render as a paperclip in some of them. The square app icon
 * reads correctly on both light and dark backgrounds, where a bare black mark
 * disappears in dark mode.
 */
export const MARK_URL = 'https://prydd.co/prydd/apple-touch-icon.png';
export const SITE_URL = 'https://prydd.co';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function paragraph(text: string, color = MUTED): string {
  return `<p style="margin:0 0 16px;font-family:${SANS};font-size:15px;line-height:24px;color:${color};">${escapeHtml(text)}</p>`;
}

export function mark(size = 40): string {
  return `<img src="${MARK_URL}" width="${size}" height="${size}" alt="Prydd" style="display:block;width:${size}px;height:${size}px;border:0;border-radius:${Math.round(size * 0.24)}px;outline:none;text-decoration:none;">`;
}

interface LayoutInput {
  title: string;
  /** The grey line inbox lists show beside the subject. */
  preheader: string;
  /** Rows of the card, already rendered. */
  body: string;
  /** Small print under the card. */
  footer: string;
}

/**
 * The frame every Prydd mail sits in: a white card on paper, table-built and
 * inline-styled because Outlook and Gmail ignore most of what a stylesheet
 * would do. Geist loads where the client allows web fonts (Apple Mail, iOS)
 * and falls back to the system face everywhere else.
 */
export function renderLayout({
  title,
  preheader,
  body,
  footer,
}: LayoutInput): string {
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; }
  a { color:${INK}; }
  @media (max-width: 600px) {
    .px { padding-left:24px !important; padding-right:24px !important; }
    .shell { padding:16px 12px !important; }
    .display { font-size:32px !important; line-height:38px !important; }
    .code { font-size:36px !important; letter-spacing:8px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${PAPER};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAPER};">
  <tr>
    <td class="shell" align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
        <tr>
          <td style="background-color:${WHITE};border-radius:16px;overflow:hidden;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${body}
            </table>
          </td>
        </tr>
        <tr>
          <td class="px" style="padding:24px 40px 0;font-family:${SANS};font-size:12px;line-height:18px;color:${MUTED};text-align:center;">
            ${footer}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

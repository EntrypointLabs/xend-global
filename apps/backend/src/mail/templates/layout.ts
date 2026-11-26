export const INK = '#0A0A0A';
export const PAPER = '#F5F5F5';
export const WHITE = '#FFFFFF';
export const MUTED = '#6B6B6B';
export const BORDER = '#E6E6E6';

export const SANS =
  "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
export const MONO =
  "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/**
 * The site's lockup (mark beside PRYDD in Montserrat with its alternate Y)
 * captured as one image: mail clients render neither SVG nor web fonts
 * reliably, and the name has to keep that Y. Its thin white outline does not
 * show on white and keeps it readable where Gmail darkens the page but cannot
 * recolour images. Hosted rather than embedded:
 * most clients block data URIs and CID attachments render as a paperclip in
 * some of them.
 */
export const LOGO_URL = 'https://prydd.co/prydd/email-logo.png?v=2';
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

function brand(): string {
  return `<img src="${LOGO_URL}" width="137" height="30" alt="PRYDD" style="display:block;width:137px;height:30px;border:0;outline:none;text-decoration:none;">`;
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
 * The frame every Prydd mail sits in: one white card on grey under the logo (on phones it has no background at all, so the mail app's own light or dark surface shows through), table-built and
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
    .px { padding-left:20px !important; padding-right:20px !important; }
    .page { background:none !important; background-color:transparent !important; }
    .shell { padding:16px 0 24px !important; }
    .card { background-color:transparent !important; border:0 !important; border-radius:0 !important; }
    .display { font-size:32px !important; line-height:38px !important; }
    .code { font-size:36px !important; letter-spacing:8px !important; }
    .inset { padding:0 !important; }
    .hero { padding:32px 20px !important; }
  }
</style>
</head>
<body class="page" style="margin:0;padding:0;background-color:${PAPER};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="page" style="background-color:${PAPER};">
  <tr>
    <td class="shell page" align="center" style="padding:32px 16px 40px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
        <tr>
          <td align="center" style="padding:0 0 24px;">${brand()}</td>
        </tr>
        <tr>
          <td class="card" style="background-color:${WHITE};border:1px solid ${BORDER};border-radius:12px;">
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

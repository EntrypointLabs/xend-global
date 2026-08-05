/**
 * Server-rendered HTML for the local test dashboard. Mirrors the ops
 * console's approach (zero client JS, one shared style block); every dynamic
 * value MUST go through escapeHtml from console-html.
 */
import { escapeHtml } from '../console/console-html';

const STYLES = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      Helvetica, Arial, sans-serif;
    color: #0a0a0a;
    margin: 0;
    padding: 0 24px 48px;
    background: #ffffff;
    max-width: 960px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 20px 0;
    border-bottom: 1px solid #e5e5e5;
    margin-bottom: 24px;
  }
  header a { color: #0a0a0a; text-decoration: none; font-weight: 600; }
  header a:hover { text-decoration: underline; }
  h1 { font-size: 20px; font-weight: 700; margin: 0 0 16px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td {
    border: 1px solid #e5e5e5;
    padding: 8px 10px;
    text-align: left;
    vertical-align: top;
  }
  th { background: #fafafa; font-weight: 600; }
  td.mono, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .empty { color: #6b7280; padding: 24px 0; }
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 6px;
    background: #dcfce7;
    color: #166534;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.03em;
  }
  .notice {
    background: #fefce8;
    border: 1px solid #fde68a;
    border-radius: 6px;
    padding: 10px 12px;
    font-size: 13px;
    margin: 0 0 16px;
  }
  .key {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 14px;
    background: #fafafa;
    border: 1px solid #e5e5e5;
    border-radius: 6px;
    padding: 12px;
    word-break: break-all;
    margin: 0 0 16px;
  }
  form { margin: 0; }
  form.create { display: flex; gap: 8px; margin: 0 0 24px; }
  input[type="text"] {
    font: inherit;
    padding: 6px 10px;
    border: 1px solid #d4d4d4;
    border-radius: 6px;
    min-width: 260px;
  }
  button {
    font: inherit;
    padding: 6px 12px;
    border: 1px solid #0a0a0a;
    background: #ffffff;
    color: #0a0a0a;
    border-radius: 6px;
    cursor: pointer;
  }
  button:hover { background: #0a0a0a; color: #ffffff; }
`;

export function testModeBadge(): string {
  return '<span class="badge">TEST MODE</span>';
}

/** Full HTML document wrapper with the shared header and style block. */
export function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Xend Test Dashboard</title>
<style>${STYLES}</style>
</head>
<body>
<header>
  <a href="/test-dashboard">Test dashboard</a>
  ${testModeBadge()}
</header>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>`;
}

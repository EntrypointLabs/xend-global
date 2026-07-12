/**
 * Server-rendered HTML for the internal ops console (ADR 0022). Zero client
 * JS, one shared style block: the smallest compliant surface for a read-only
 * pilot tool. ADR 0001 (NativeWind className) governs React Native surfaces,
 * not this server HTML. Every dynamic value interpolated into a view MUST go
 * through escapeHtml — merchant names and endpoint URLs are stored strings.
 */

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
  }
  nav {
    display: flex;
    gap: 20px;
    padding: 20px 0;
    border-bottom: 1px solid #e5e5e5;
    margin-bottom: 24px;
  }
  nav a { color: #0a0a0a; text-decoration: none; font-weight: 600; }
  nav a:hover { text-decoration: underline; }
  h1 { font-size: 20px; font-weight: 700; margin: 0 0 16px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td {
    border: 1px solid #e5e5e5;
    padding: 8px 10px;
    text-align: left;
    vertical-align: top;
  }
  th { background: #fafafa; font-weight: 600; }
  td.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .muted { color: #6b7280; }
  .empty { color: #6b7280; padding: 24px 0; }
  form { margin: 0; }
  button {
    font: inherit;
    padding: 4px 10px;
    border: 1px solid #0a0a0a;
    background: #ffffff;
    color: #0a0a0a;
    border-radius: 6px;
    cursor: pointer;
  }
  button:hover { background: #0a0a0a; color: #ffffff; }
`;

/** Escape the five HTML-significant characters. Applied to every dynamic value. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Full HTML document wrapper with the shared nav and style block. */
export function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Xend Console</title>
<style>${STYLES}</style>
</head>
<body>
<nav>
  <a href="/console/payments">Payments</a>
  <a href="/console/deliveries">Deliveries</a>
  <a href="/console/keys">Keys</a>
</nav>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>`;
}

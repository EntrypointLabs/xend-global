import { renderCodeEmail } from './code-email';
import { renderLaunchAnnouncement } from './launch-announcement';
import { renderNoticeEmail } from './notice-email';

describe('renderCodeEmail', () => {
  const copy = {
    code: '482913',
    expiresInMinutes: 10,
    title: 'Your recovery code',
    lead: 'Enter this code in Prydd.',
    details: ['Moving a phone takes <24> hours & more.'],
    notMe: 'Someone else knows your email address.',
  };

  it('puts the code and its expiry in both parts', () => {
    const { html, text } = renderCodeEmail(copy);

    for (const part of [html, text]) {
      expect(part).toContain('482913');
      expect(part).toContain('It expires in 10 minutes.');
    }
  });

  it('escapes copy before it reaches the markup', () => {
    const { html } = renderCodeEmail(copy);

    expect(html).toContain('&lt;24&gt; hours &amp; more');
    expect(html).not.toContain('<24>');
  });
});

describe('renderLaunchAnnouncement', () => {
  it('links the App Store and carries the Broadcast unsubscribe placeholder', () => {
    const { html, text } = renderLaunchAnnouncement();

    for (const part of [html, text]) {
      expect(part).toContain('https://apps.apple.com/app/id6829126490');
      expect(part).toContain('{{{RESEND_UNSUBSCRIBE_URL}}}');
    }
  });
});

describe('renderNoticeEmail', () => {
  it('leads with what happened and ends on what to do, escaped', () => {
    const html = renderNoticeEmail({
      title: 'A recovery key was added',
      paragraphs: [
        '<b>a@example.com</b> was added as a recovery key.',
        'If this was not you, contact support from the app right away.',
      ],
    });

    expect(html).toContain('&lt;b&gt;a@example.com&lt;/b&gt;');
    expect(html.lastIndexOf('contact support')).toBeGreaterThan(
      html.indexOf('was added as a recovery key'),
    );
  });
});

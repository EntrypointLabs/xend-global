import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Result } from './Result';

describe('Checkout result disclosure', () => {
  it('does not represent an unconfirmed Payment as a success', () => {
    const html = renderToStaticMarkup(<Result status="succeeded" pending />);
    expect(html).toContain('Waiting for confirmation');
    expect(html).toContain('Check Activity');
    expect(html).not.toContain('Payment complete');
    expect(html).not.toContain('receipt is on its way');
    expect(html).not.toContain('border-success');
  });

  it('reserves the success mark for confirmed success', () => {
    const html = renderToStaticMarkup(<Result status="succeeded" />);
    expect(html).toContain('Payment complete');
    expect(html).toContain('border-success');
    expect(html).toContain('role="status"');
  });

  it.each(['canceled', 'expired', 'failed'] as const)(
    'never shows success for %s',
    (status) => {
      const html = renderToStaticMarkup(<Result status={status} />);
      expect(html).not.toContain('Payment complete');
      expect(html).not.toContain('border-success');
      expect(html).toContain('Xend');
    },
  );

  it('invites a retry when this attempt was dismissed', () => {
    const html = renderToStaticMarkup(<Result status="canceled" />);
    expect(html).toContain('This attempt was canceled');
    expect(html).toContain('try again');
  });

  it('does not promise a retry when the merchant canceled the intent', () => {
    const html = renderToStaticMarkup(<Result status="canceled" terminal />);
    expect(html).toContain('This order was canceled');
    expect(html).not.toContain('try again');
  });
});

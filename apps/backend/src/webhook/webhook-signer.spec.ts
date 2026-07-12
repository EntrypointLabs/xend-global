import { signWebhook, verifyWebhook } from './webhook-signer';

const TOLERANCE = 300;

describe('webhook-signer', () => {
  it('signs then verifies a round-trip', () => {
    const body = JSON.stringify({ id: 'evt_1', type: 'payment.succeeded' });
    const ts = 1_000_000;
    const header = signWebhook(body, ['whsec_primary'], ts);
    expect(header).toContain(`t=${ts}`);
    expect(header).toContain('v1=');
    expect(verifyWebhook(body, header, 'whsec_primary', TOLERANCE, ts)).toBe(
      true,
    );
  });

  it('rejects a tampered body', () => {
    const ts = 1_000_000;
    const header = signWebhook('original', ['whsec_primary'], ts);
    expect(
      verifyWebhook('tampered', header, 'whsec_primary', TOLERANCE, ts),
    ).toBe(false);
  });

  it('rejects an out-of-tolerance timestamp', () => {
    const ts = 1_000_000;
    const header = signWebhook('body', ['whsec_primary'], ts);
    expect(
      verifyWebhook(
        'body',
        header,
        'whsec_primary',
        TOLERANCE,
        ts + TOLERANCE + 1,
      ),
    ).toBe(false);
  });

  it('verifies against either secret during dual-secret rotation', () => {
    const ts = 1_000_000;
    const body = 'rotating';
    const header = signWebhook(body, ['whsec_new', 'whsec_old'], ts);
    // A merchant still holding the old secret verifies.
    expect(verifyWebhook(body, header, 'whsec_old', TOLERANCE, ts)).toBe(true);
    // And one already on the new secret verifies.
    expect(verifyWebhook(body, header, 'whsec_new', TOLERANCE, ts)).toBe(true);
  });

  it('rejects a signature from an unrelated secret', () => {
    const ts = 1_000_000;
    const header = signWebhook('body', ['whsec_primary'], ts);
    expect(verifyWebhook('body', header, 'whsec_other', TOLERANCE, ts)).toBe(
      false,
    );
  });
});

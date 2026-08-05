import { signReturnUrl, verifyReturnUrl } from './return-url';

const SECRET = 'checkout-return-secret';
const TTL = 900;
const BASE = 'https://shop.example.com/return';

function parse(signed: string) {
  const url = new URL(signed);
  return {
    intentId: url.searchParams.get('xend_intent_id') as string,
    status: url.searchParams.get('xend_status') as
      | 'succeeded'
      | 'failed'
      | 'canceled'
      | 'expired',
    ts: Number(url.searchParams.get('xend_ts')),
    sig: url.searchParams.get('xend_sig') as string,
  };
}

describe('return-url sign/verify', () => {
  it('round-trips each terminal status', () => {
    for (const status of [
      'succeeded',
      'failed',
      'canceled',
      'expired',
    ] as const) {
      const signed = signReturnUrl(BASE, 'pi_1', status, SECRET);
      const p = parse(signed);
      expect(p.intentId).toBe('pi_1');
      expect(p.status).toBe(status);
      expect(
        verifyReturnUrl(BASE, 'pi_1', status, p.ts, p.sig, SECRET, TTL),
      ).toBe(true);
    }
  });

  it('fails when the status is tampered', () => {
    const signed = signReturnUrl(BASE, 'pi_1', 'succeeded', SECRET);
    const p = parse(signed);
    expect(
      verifyReturnUrl(BASE, 'pi_1', 'failed', p.ts, p.sig, SECRET, TTL),
    ).toBe(false);
  });

  it('fails when the base URL is swapped', () => {
    const signed = signReturnUrl(BASE, 'pi_1', 'succeeded', SECRET);
    const p = parse(signed);
    expect(
      verifyReturnUrl(
        'https://evil.example.com/return',
        'pi_1',
        'succeeded',
        p.ts,
        p.sig,
        SECRET,
        TTL,
      ),
    ).toBe(false);
  });

  it('fails when the timestamp is beyond the TTL', () => {
    const now = 1_000_000;
    const signed = signReturnUrl(
      BASE,
      'pi_1',
      'succeeded',
      SECRET,
      now - TTL - 1,
    );
    const p = parse(signed);
    expect(
      verifyReturnUrl(BASE, 'pi_1', 'succeeded', p.ts, p.sig, SECRET, TTL, now),
    ).toBe(false);
  });

  it('fails when the timestamp is skewed too far into the future', () => {
    const now = 1_000_000;
    const signed = signReturnUrl(BASE, 'pi_1', 'succeeded', SECRET, now + 120);
    const p = parse(signed);
    expect(
      verifyReturnUrl(BASE, 'pi_1', 'succeeded', p.ts, p.sig, SECRET, TTL, now),
    ).toBe(false);
  });
});

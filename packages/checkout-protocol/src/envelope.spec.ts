import { describe, it, expect } from 'vitest';
import {
  buildResult,
  buildCancel,
  parseCheckoutMessage,
  CheckoutStatusSchema,
  CHECKOUT_ORIGIN,
  CHECKOUT_PROTOCOL_VERSION,
} from './index';

const NONCE = 'n_abc123';
const REFERENCE = 'pi_abc123';
const MERCHANT_ORIGIN = 'https://shop.example.com';
const EXPECTED = {
  origin: MERCHANT_ORIGIN,
  nonce: NONCE,
  reference: REFERENCE,
} as const;

describe('buildResult', () => {
  it('produces a checkout result envelope with the given status', () => {
    const env = buildResult(NONCE, REFERENCE, 'succeeded');
    expect(env.xend).toBe('checkout');
    expect(env.v).toBe(1);
    expect(env.type).toBe('xend.checkout.result');
    expect(env.status).toBe('succeeded');
    expect(env.nonce).toBe(NONCE);
    expect(env.reference).toBe(REFERENCE);
  });

  it('carries a failed status verbatim', () => {
    expect(buildResult(NONCE, REFERENCE, 'failed').status).toBe('failed');
  });

  it('carries an expired status verbatim', () => {
    expect(buildResult(NONCE, REFERENCE, 'expired').status).toBe('expired');
  });
});

describe('buildCancel', () => {
  it('carries status canceled by contract', () => {
    const env = buildCancel(NONCE, REFERENCE);
    expect(env.type).toBe('xend.checkout.cancel');
    expect(env.status).toBe('canceled');
  });
});

describe('parseCheckoutMessage', () => {
  const valid = buildResult(NONCE, REFERENCE, 'succeeded');

  it('returns the envelope for an exact-origin, matching-nonce, matching-reference message', () => {
    const out = parseCheckoutMessage(
      { origin: MERCHANT_ORIGIN, data: valid },
      EXPECTED,
    );
    expect(out).toEqual(valid);
  });

  it('accepts a cancel message and preserves its canceled status', () => {
    const cancel = buildCancel(NONCE, REFERENCE);
    const out = parseCheckoutMessage(
      { origin: MERCHANT_ORIGIN, data: cancel },
      EXPECTED,
    );
    expect(out?.status).toBe('canceled');
  });

  it('rejects a substring-spoofed origin', () => {
    expect(
      parseCheckoutMessage(
        { origin: 'https://shop.example.com.evil.com', data: valid },
        EXPECTED,
      ),
    ).toBeNull();
  });

  it('rejects a prefix-spoofed origin', () => {
    expect(
      parseCheckoutMessage(
        { origin: 'https://shop.example.com', data: valid },
        { ...EXPECTED, origin: 'https://shop.example.co' },
      ),
    ).toBeNull();
  });

  it('rejects a literal null origin (sandboxed frame)', () => {
    expect(
      parseCheckoutMessage(
        { origin: 'null', data: valid },
        { ...EXPECTED, origin: 'null' },
      ),
    ).toBeNull();
  });

  it('rejects a wildcard/mismatched origin', () => {
    expect(
      parseCheckoutMessage({ origin: '*', data: valid }, EXPECTED),
    ).toBeNull();
  });

  it('rejects a nonce mismatch', () => {
    expect(
      parseCheckoutMessage(
        { origin: MERCHANT_ORIGIN, data: valid },
        {
          ...EXPECTED,
          nonce: 'n_other',
        },
      ),
    ).toBeNull();
  });

  it('rejects a reference mismatch', () => {
    expect(
      parseCheckoutMessage(
        { origin: MERCHANT_ORIGIN, data: valid },
        {
          ...EXPECTED,
          reference: 'pi_other',
        },
      ),
    ).toBeNull();
  });

  it('rejects an unknown version', () => {
    const wrongVersion = { ...valid, v: 2 };
    expect(
      parseCheckoutMessage(
        { origin: MERCHANT_ORIGIN, data: wrongVersion },
        EXPECTED,
      ),
    ).toBeNull();
  });

  it('rejects a non-object payload', () => {
    expect(
      parseCheckoutMessage(
        { origin: MERCHANT_ORIGIN, data: 'not-an-envelope' },
        EXPECTED,
      ),
    ).toBeNull();
  });
});

describe('CheckoutStatusSchema', () => {
  it('accepts exactly the four canonical statuses', () => {
    for (const status of ['succeeded', 'failed', 'canceled', 'expired']) {
      expect(CheckoutStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it('rejects the double-l British spelling', () => {
    const britishSpelling = 'cancel' + 'led';
    expect(CheckoutStatusSchema.safeParse(britishSpelling).success).toBe(false);
  });
});

describe('constants', () => {
  it('pins the canonical checkout origin and version', () => {
    expect(CHECKOUT_ORIGIN).toBe('https://pay.xend.global');
    expect(CHECKOUT_PROTOCOL_VERSION).toBe(1);
  });
});

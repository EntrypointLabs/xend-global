// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { postResultToOpener, postCancelToOpener } from './postMessage';

const MERCHANT_ORIGIN = 'https://shop.example.com';
const NONCE = 'n_abc';
const REFERENCE = 'pi_abc';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubOpener() {
  const postMessage = vi.fn();
  Object.defineProperty(window, 'opener', {
    value: { postMessage },
    configurable: true,
    writable: true,
  });
  return postMessage;
}

function clearOpener() {
  Object.defineProperty(window, 'opener', {
    value: null,
    configurable: true,
    writable: true,
  });
}

describe('postResultToOpener', () => {
  it('posts a valid result envelope to exactly the merchant origin', () => {
    const postMessage = stubOpener();
    const sent = postResultToOpener(
      MERCHANT_ORIGIN,
      NONCE,
      REFERENCE,
      'succeeded',
    );
    expect(sent).toBe(true);
    expect(postMessage).toHaveBeenCalledTimes(1);
    const [payload, targetOrigin] = postMessage.mock.calls[0]!;
    expect(targetOrigin).toBe(MERCHANT_ORIGIN);
    expect(payload).toMatchObject({
      xend: 'checkout',
      v: 1,
      nonce: NONCE,
      reference: REFERENCE,
      type: 'xend.checkout.result',
      status: 'succeeded',
    });
  });

  it('returns false and posts nothing when the opener is gone', () => {
    clearOpener();
    expect(
      postResultToOpener(MERCHANT_ORIGIN, NONCE, REFERENCE, 'failed'),
    ).toBe(false);
  });
});

describe('postCancelToOpener', () => {
  it('posts a cancel envelope carrying status canceled to the merchant origin', () => {
    const postMessage = stubOpener();
    const sent = postCancelToOpener(MERCHANT_ORIGIN, NONCE, REFERENCE);
    expect(sent).toBe(true);
    const [payload, targetOrigin] = postMessage.mock.calls[0]!;
    expect(targetOrigin).toBe(MERCHANT_ORIGIN);
    expect(payload).toMatchObject({
      type: 'xend.checkout.cancel',
      status: 'canceled',
    });
  });

  it('returns false when the opener is gone', () => {
    clearOpener();
    expect(postCancelToOpener(MERCHANT_ORIGIN, NONCE, REFERENCE)).toBe(false);
  });
});

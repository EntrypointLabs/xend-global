// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  postReadyToMerchant,
  postResultToMerchant,
  postCancelToMerchant,
} from './postMessage';

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

function setParent(value: unknown) {
  Object.defineProperty(window, 'parent', {
    value,
    configurable: true,
    writable: true,
  });
}

afterEach(() => setParent(window));

describe('postReadyToMerchant', () => {
  it('posts a handshake with the nonce and no reference or status', () => {
    const postMessage = stubOpener();
    expect(postReadyToMerchant(MERCHANT_ORIGIN, NONCE)).toBe(true);
    const [payload, targetOrigin] = postMessage.mock.calls[0]!;
    expect(targetOrigin).toBe(MERCHANT_ORIGIN);
    expect(payload).toEqual({
      xend: 'checkout',
      v: 1,
      nonce: NONCE,
      type: 'xend.checkout.ready',
    });
  });

  it('posts the handshake to the parent when the surface is framed', () => {
    const openerPost = stubOpener();
    const parentPost = vi.fn();
    setParent({ postMessage: parentPost });

    expect(postReadyToMerchant(MERCHANT_ORIGIN, NONCE)).toBe(true);
    expect(openerPost).not.toHaveBeenCalled();
    expect(parentPost.mock.calls[0]![1]).toBe(MERCHANT_ORIGIN);
    expect(parentPost.mock.calls[0]![0]).toMatchObject({
      type: 'xend.checkout.ready',
    });
  });

  it('returns false and posts nothing when there is no channel', () => {
    clearOpener();
    expect(postReadyToMerchant(MERCHANT_ORIGIN, NONCE)).toBe(false);
  });
});

describe('postResultToMerchant', () => {
  it('posts a valid result envelope to exactly the merchant origin', () => {
    const postMessage = stubOpener();
    const sent = postResultToMerchant(
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
      postResultToMerchant(MERCHANT_ORIGIN, NONCE, REFERENCE, 'failed'),
    ).toBe(false);
  });
});

describe('when the surface is framed', () => {
  it('posts the result to the parent, not the opener, with the same envelope', () => {
    const openerPost = stubOpener();
    const parentPost = vi.fn();
    setParent({ postMessage: parentPost });

    const sent = postResultToMerchant(
      MERCHANT_ORIGIN,
      NONCE,
      REFERENCE,
      'succeeded',
    );

    expect(sent).toBe(true);
    expect(openerPost).not.toHaveBeenCalled();
    const [payload, targetOrigin] = parentPost.mock.calls[0]!;
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

  it('posts a cancel to the parent even with no opener at all', () => {
    clearOpener();
    const parentPost = vi.fn();
    setParent({ postMessage: parentPost });

    expect(postCancelToMerchant(MERCHANT_ORIGIN, NONCE, REFERENCE)).toBe(true);
    expect(parentPost.mock.calls[0]![1]).toBe(MERCHANT_ORIGIN);
    expect(parentPost.mock.calls[0]![0]).toMatchObject({
      type: 'xend.checkout.cancel',
      status: 'canceled',
    });
  });
});

describe('postCancelToMerchant', () => {
  it('posts a cancel envelope carrying status canceled to the merchant origin', () => {
    const postMessage = stubOpener();
    const sent = postCancelToMerchant(MERCHANT_ORIGIN, NONCE, REFERENCE);
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
    expect(postCancelToMerchant(MERCHANT_ORIGIN, NONCE, REFERENCE)).toBe(false);
  });
});

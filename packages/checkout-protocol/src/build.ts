import type {
  CheckoutEnvelope,
  CheckoutReadyEnvelope,
  CheckoutStatus,
  CheckoutUnresolvedEnvelope,
  CheckoutUnresolvedReason,
} from './types';

/** Bump only for a breaking envelope change; consumers ignore unknown versions. */
export const CHECKOUT_PROTOCOL_VERSION = 1 as const;

/** The one origin the checkout surface is ever served from. */
export const CHECKOUT_ORIGIN = 'https://pay.prydd.co' as const;

export const CheckoutMessageType = {
  Ready: 'prydd.checkout.ready',
  Unresolved: 'prydd.checkout.unresolved',
  Result: 'prydd.checkout.result',
  Cancel: 'prydd.checkout.cancel',
} as const;

export function buildUnresolved(
  nonce: string,
  reference: string,
  reason: CheckoutUnresolvedReason,
): CheckoutUnresolvedEnvelope {
  return {
    prydd: 'checkout',
    v: CHECKOUT_PROTOCOL_VERSION,
    nonce,
    reference,
    type: CheckoutMessageType.Unresolved,
    reason,
  };
}

/** Mount handshake. No reference and no status: neither exists yet. */
export function buildReady(nonce: string): CheckoutReadyEnvelope {
  return {
    prydd: 'checkout',
    v: CHECKOUT_PROTOCOL_VERSION,
    nonce,
    type: CheckoutMessageType.Ready,
  };
}

export function buildResult(
  nonce: string,
  reference: string,
  status: CheckoutStatus,
): CheckoutEnvelope {
  return {
    prydd: 'checkout',
    v: CHECKOUT_PROTOCOL_VERSION,
    nonce,
    reference,
    type: CheckoutMessageType.Result,
    status,
  };
}

/** User-initiated close/back-out; carries status 'canceled' by contract. */
export function buildCancel(
  nonce: string,
  reference: string,
): CheckoutEnvelope {
  return {
    prydd: 'checkout',
    v: CHECKOUT_PROTOCOL_VERSION,
    nonce,
    reference,
    type: CheckoutMessageType.Cancel,
    status: 'canceled',
  };
}

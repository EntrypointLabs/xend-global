/**
 * Typed errors thrown by the webhook services and controllers. Plain Error
 * subclasses with a SCREAMING_SNAKE `code` (same posture as transfer.errors.ts).
 */

export class WebhookEndpointNotFoundError extends Error {
  readonly code = 'WEBHOOK_ENDPOINT_NOT_FOUND';
  constructor(message: string) {
    super(message);
    this.name = 'WebhookEndpointNotFoundError';
  }
}

export class WebhookDeliveryNotFoundError extends Error {
  readonly code = 'WEBHOOK_DELIVERY_NOT_FOUND';
  constructor(message: string) {
    super(message);
    this.name = 'WebhookDeliveryNotFoundError';
  }
}

/** A concurrent rotation changed the endpoint's primary secret first; retry. */
export class WebhookSecretRotationConflictError extends Error {
  readonly code = 'WEBHOOK_SECRET_ROTATION_CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'WebhookSecretRotationConflictError';
  }
}

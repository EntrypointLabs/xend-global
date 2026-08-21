/**
 * Typed errors from the Turnkey adapter. Plain Error subclasses with a
 * SCREAMING_SNAKE `code`, kept out of @nestjs/common so the service stays
 * HTTP-framework-agnostic (same posture as recovery.errors.ts).
 */

export class TurnkeyUnavailableError extends Error {
  readonly code = 'TURNKEY_UNAVAILABLE';
  constructor(message: string) {
    super(message);
    this.name = 'TurnkeyUnavailableError';
  }
}

/**
 * Enrolment created a sub-organization but did not finish narrowing its root
 * quorum, so the delegated backend user is still a root user on it.
 *
 * This is the one failure in the flow that is worse than no sub-org at all: a
 * root-quorum backend can register its own authenticator on the S2 wallet and
 * sign as S2, and the backend already holds S3. One compromise would then reach
 * threshold, which is the invariant ADR 0025 exists to hold.
 *
 * The sub-org id is carried so the caller can quarantine and delete it. It must
 * never be handed to a Consumer as their approval signer.
 */
export class UnsafeSubOrganizationError extends Error {
  readonly code = 'UNSAFE_SUB_ORGANIZATION';
  constructor(
    message: string,
    readonly subOrganizationId: string,
  ) {
    super(message);
    this.name = 'UnsafeSubOrganizationError';
  }
}

export class ApprovalSignerShapeError extends Error {
  readonly code = 'APPROVAL_SIGNER_SHAPE';
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalSignerShapeError';
  }
}

/**
 * The seam over Turnkey, which holds the approval signer (S2 in ADR 0025).
 *
 * Only `turnkey.client.ts` imports `@turnkey/*`; everything else depends on
 * this contract. Same anti-lock-in posture as `wallet-provider.interface.ts`.
 *
 * The backend's role is deliberately narrow. It enrols a Consumer's
 * sub-organization using the parent API key, which is a parent-org activity and
 * cannot happen on a device, and then leaves the request path. Signing is
 * stamped on the phone by the hardware key, so no server-side signing method
 * belongs here.
 */

export const TURNKEY_API = Symbol('TURNKEY_API');

/** Compressed P-256 public key, hex, generated in the phone's secure hardware. */
export type HardwarePublicKey = string;

export interface EnrolApprovalSignerParams {
  /**
   * The Consumer's user id. Names the sub-org for support and audit, and is
   * the key the stored sub-organization is found by on a retry, so it has to
   * be a real user id rather than any opaque string.
   */
  reference: string;
  hardwarePublicKey: HardwarePublicKey;
}

export interface EnrolledApprovalSigner {
  subOrganizationId: string;
  /** Base58 Solana pubkey. This is S2's address in the Squads signer set. */
  address: string;
}

/**
 * The four Turnkey calls the enrolment sequence needs, and nothing else.
 *
 * Narrow on purpose: a fake in a test implements four methods rather than the
 * SDK's several hundred, and widening it is a deliberate act.
 */
export interface TurnkeyApi {
  createSubOrganization(params: {
    subOrganizationName: string;
    rootUsers: TurnkeyRootUser[];
    rootQuorumThreshold: number;
    wallet: { walletName: string; accounts: unknown[] };
    disableEmailAuth: boolean;
    disableEmailRecovery: boolean;
    disableOtpEmailAuth: boolean;
    disableSmsAuth: boolean;
  }): Promise<{
    subOrganizationId: string;
    rootUserIds?: string[];
    wallet?: { walletId: string; addresses: string[] };
  }>;

  createPolicy(params: {
    organizationId: string;
    policyName: string;
    effect: 'EFFECT_ALLOW' | 'EFFECT_DENY';
    consensus: string;
    condition: string;
    notes: string;
  }): Promise<{ policyId: string }>;

  updateRootQuorum(params: {
    organizationId: string;
    threshold: number;
    userIds: string[];
  }): Promise<unknown>;

  /** Reads the quorum back, so narrowing can be proven rather than assumed. */
  getRootQuorum(params: {
    organizationId: string;
  }): Promise<{ threshold: number; userIds: string[] }>;
}

export interface TurnkeyRootUser {
  userName: string;
  apiKeys: {
    apiKeyName: string;
    publicKey: string;
    curveType: 'API_KEY_CURVE_P256' | 'API_KEY_CURVE_ED25519';
  }[];
  authenticators: unknown[];
  oauthProviders: unknown[];
}

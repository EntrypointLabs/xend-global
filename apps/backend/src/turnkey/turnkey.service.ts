import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  APPROVAL_SIGNER_STORE,
  type ApprovalSignerStore,
} from './approval-signer.store';
import {
  ApprovalSignerShapeError,
  TurnkeyUnavailableError,
  UnsafeSubOrganizationError,
} from './turnkey.errors';
import { TURNKEY_API } from './turnkey.interface';
import type {
  EnrolApprovalSignerParams,
  EnrolledApprovalSigner,
  TurnkeyApi,
} from './turnkey.interface';

/**
 * Enrols the approval signer (S2) as a Turnkey sub-organization.
 *
 * ## The sequence, and why its order is forced
 *
 * A delegated user can only be added to a sub-org at creation, and the root
 * quorum can only be narrowed afterwards. Creating the policy that grants the
 * delegated user its authority is itself a root-quorum activity, so it has to
 * happen while the backend is still a root user. That pins the order to
 * create -> policy -> narrow, with no way to avoid a window in which the
 * backend is a root user on the Consumer's sub-org.
 *
 * That window is the whole risk. A root-quorum backend can register its own
 * authenticator on the S2 wallet and sign as S2, and the backend already holds
 * S3, so a compromise inside the window reaches threshold. Enrolment therefore
 * proves the narrowing rather than assuming it, and a sub-org left mid-sequence
 * is reported as unsafe instead of returned.
 *
 * See O6 in `docs/specs/account-security-model-decisions.md`.
 */
@Injectable()
export class TurnkeyService {
  private readonly logger = new Logger(TurnkeyService.name);

  constructor(
    @Inject(TURNKEY_API) private readonly api: TurnkeyApi,
    private readonly delegatedUserPublicKey: string,
    @Inject(APPROVAL_SIGNER_STORE) private readonly store: ApprovalSignerStore,
  ) {}

  /**
   * The enrolment entry point, safe to call again after a failed Account.
   *
   * The sub-organization is created before anything is written on chain, so a
   * failure in between (an unfunded settlement authority, a lost seed race)
   * leaves one that no Account references. Calling `enrolApprovalSigner`
   * again would create a second and strand the first with the Consumer's
   * hardware key on it, which is where the orphans come from.
   *
   * Recorded the moment it exists, so the retry finds it. Reuse is keyed on
   * the device as well as the Consumer: the sub-org's only authenticator is
   * that hardware key, so a replacement device has to enrol a new one rather
   * than inherit an S2 it cannot sign for.
   */
  async ensureApprovalSigner(
    params: EnrolApprovalSignerParams,
  ): Promise<EnrolledApprovalSigner> {
    const existing = await this.store.findByUserAndDevice(
      params.reference,
      params.hardwarePublicKey,
    );
    if (existing) {
      this.logger.log(
        `turnkey.enrolment.reused subOrganizationId=${existing.subOrganizationId}`,
      );
      return {
        subOrganizationId: existing.subOrganizationId,
        address: existing.address,
      };
    }

    const enrolled = await this.enrolApprovalSigner(params);

    // After the narrowing, never before. A sub-org recorded mid-sequence would
    // be handed back by the next retry with the backend still a root user on
    // it, which is the exact state enrolApprovalSigner refuses to return.
    await this.store.insert({
      userId: params.reference,
      subOrganizationId: enrolled.subOrganizationId,
      address: enrolled.address,
      hardwarePublicKey: params.hardwarePublicKey,
    });

    return enrolled;
  }

  async enrolApprovalSigner(
    params: EnrolApprovalSignerParams,
  ): Promise<EnrolledApprovalSigner> {
    const created = await this.createSubOrganization(params);
    const { subOrganizationId } = created;

    const address = created.wallet?.addresses?.[0];
    if (!address) {
      throw new UnsafeSubOrganizationError(
        'Turnkey returned a sub-organization with no wallet address',
        subOrganizationId,
      );
    }

    // Both root user ids, in the order they were requested.
    const [delegatedUserId, consumerUserId] = created.rootUserIds ?? [];
    if (!delegatedUserId || !consumerUserId) {
      throw new UnsafeSubOrganizationError(
        'Turnkey returned fewer root users than were requested',
        subOrganizationId,
      );
    }

    await this.grantPolicyAuthority(subOrganizationId, delegatedUserId);
    await this.narrowRootQuorum(subOrganizationId, consumerUserId);

    return { subOrganizationId, address };
  }

  private async createSubOrganization(params: EnrolApprovalSignerParams) {
    if (!params.hardwarePublicKey) {
      throw new ApprovalSignerShapeError(
        'Refusing to enrol an approval signer with no hardware public key',
      );
    }
    if (!this.delegatedUserPublicKey) {
      throw new ApprovalSignerShapeError(
        'TURNKEY_DELEGATED_PUBLIC_KEY is not configured',
      );
    }

    try {
      return await this.api.createSubOrganization({
        subOrganizationName: `xend-approval-${params.reference}`,
        rootUsers: [
          {
            userName: 'xend-delegated',
            apiKeys: [
              {
                apiKeyName: 'xend-delegated-policy',
                publicKey: this.delegatedUserPublicKey,
                curveType: 'API_KEY_CURVE_P256',
              },
            ],
            authenticators: [],
            oauthProviders: [],
          },
          {
            userName: 'consumer-device',
            apiKeys: [
              {
                apiKeyName: 'device-hardware-key',
                publicKey: params.hardwarePublicKey,
                curveType: 'API_KEY_CURVE_P256',
              },
            ],
            authenticators: [],
            oauthProviders: [],
          },
        ],
        rootQuorumThreshold: 1,
        wallet: {
          walletName: 'approval-signer',
          accounts: [SOLANA_ACCOUNT],
        },
        // Not options. Every one of these defaults to on, and omitting a single
        // one silently ships an S2 that an email can unlock, which collapses
        // the possession anchor into the inbox anchor S3 already occupies.
        disableEmailAuth: true,
        disableEmailRecovery: true,
        disableOtpEmailAuth: true,
        disableSmsAuth: true,
      });
    } catch (cause) {
      throw new TurnkeyUnavailableError(
        `Could not create the approval signer: ${describe(cause)}`,
      );
    }
  }

  /**
   * Grants the delegated user policy authority and nothing else.
   *
   * Deliberately not `ACTIVITY_TYPE_SIGN_*`: the delegated user must never be
   * able to produce an S2 signature. It can change what S2 is permitted to
   * sign, which still requires the Consumer's hardware key to act on.
   */
  private async grantPolicyAuthority(
    subOrganizationId: string,
    delegatedUserId: string,
  ): Promise<void> {
    try {
      await this.api.createPolicy({
        organizationId: subOrganizationId,
        policyName: 'xend-delegated-policy-authority',
        effect: 'EFFECT_ALLOW',
        consensus: `approvers.any(user, user.id == '${delegatedUserId}')`,
        condition:
          "activity.type == 'ACTIVITY_TYPE_CREATE_POLICY_V3' || " +
          "activity.type == 'ACTIVITY_TYPE_UPDATE_POLICY_V2' || " +
          "activity.type == 'ACTIVITY_TYPE_DELETE_POLICY'",
        notes:
          'Delegated policy authority for the Xend backend. Deliberately ' +
          'excludes every signing activity: see O6.',
      });
    } catch (cause) {
      throw new UnsafeSubOrganizationError(
        `Could not grant delegated policy authority: ${describe(cause)}`,
        subOrganizationId,
      );
    }
  }

  /**
   * Removes the backend from the root quorum, leaving the Consumer's device key
   * alone in it, then reads the quorum back to prove it.
   *
   * The read-back is not defensive habit. Narrowing is the step that closes the
   * window, so its success is the one thing in this flow that must not be
   * inferred from a call that did not throw.
   */
  private async narrowRootQuorum(
    subOrganizationId: string,
    consumerUserId: string,
  ): Promise<void> {
    try {
      await this.api.updateRootQuorum({
        organizationId: subOrganizationId,
        threshold: 1,
        userIds: [consumerUserId],
      });
    } catch (cause) {
      throw new UnsafeSubOrganizationError(
        `Could not narrow the root quorum: ${describe(cause)}`,
        subOrganizationId,
      );
    }

    const quorum = await this.readRootQuorum(subOrganizationId);
    const narrowed =
      quorum.userIds.length === 1 && quorum.userIds[0] === consumerUserId;

    if (!narrowed) {
      throw new UnsafeSubOrganizationError(
        `Root quorum still holds ${quorum.userIds.length} users after narrowing`,
        subOrganizationId,
      );
    }

    this.logger.log(
      `turnkey.enrolment.narrowed subOrganizationId=${subOrganizationId}`,
    );
  }

  private async readRootQuorum(subOrganizationId: string) {
    try {
      return await this.api.getRootQuorum({
        organizationId: subOrganizationId,
      });
    } catch (cause) {
      throw new UnsafeSubOrganizationError(
        `Could not confirm the root quorum: ${describe(cause)}`,
        subOrganizationId,
      );
    }
  }
}

/** Turnkey's default Solana derivation, spelled out so the path is reviewable. */
const SOLANA_ACCOUNT = {
  curve: 'CURVE_ED25519',
  pathFormat: 'PATH_FORMAT_BIP32',
  path: "m/44'/501'/0'/0'",
  addressFormat: 'ADDRESS_FORMAT_SOLANA',
};

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

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
 * quorum can only be narrowed afterwards. That pins the order to
 * create -> narrow, with no way to avoid a window in which the backend is a
 * root user on the Consumer's sub-org.
 *
 * The backend keeps no standing authority once the window closes. It held
 * policy authority here for a while, which reads as harmless because it
 * excluded every signing activity — but the authority to write policies is the
 * authority to write a policy granting yourself the signing ones, so it was a
 * one-step path from a backend compromise to an S2 signature, and S3 is
 * already the backend's. Nothing at run time needed it.
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
  /**
   * The enrolment already on file for this Consumer's device, if any.
   *
   * Lets a retry that was interrupted after the sub-org existed carry on with
   * the same key instead of minting a new one, which would strand the first S2
   * and can never reach the reuse path above.
   */
  findEnrolledDevice(
    userId: string,
    hardwarePublicKey: string,
  ): Promise<{ security: string | null } | null> {
    return this.store
      .findByUserAndDevice(userId, hardwarePublicKey)
      .then((row) => (row ? { security: row.security } : null));
  }

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
      security: params.security,
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

    // Both root users were requested in a fixed order, and the Consumer's is
    // the second. Fewer than two means the sub-org is not the shape that was
    // asked for, and narrowing the quorum of an unknown shape is not safe.
    const rootUserIds = created.rootUserIds ?? [];
    const consumerUserId = rootUserIds[1];
    if (rootUserIds.length < 2 || !consumerUserId) {
      throw new UnsafeSubOrganizationError(
        'Turnkey returned fewer root users than were requested',
        subOrganizationId,
      );
    }

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

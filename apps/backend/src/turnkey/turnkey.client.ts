import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Turnkey, TurnkeyApiClient } from '@turnkey/sdk-server';

import { TurnkeyUnavailableError } from './turnkey.errors';
import { TurnkeyApi, TurnkeyRootUser } from './turnkey.interface';

/**
 * The only place `@turnkey/*` is imported, per ADR 0024.
 *
 * Everything above this file talks to `TurnkeyApi`, which is four methods wide.
 * The SDK's surface stops here.
 *
 * The SDK is constructed on first use rather than at module init, so a
 * deployment without Turnkey credentials boots and serves every other route.
 * Enrolment is the only thing that fails, and it fails where it is called.
 */
@Injectable()
export class TurnkeySdkClient implements TurnkeyApi {
  private readonly logger = new Logger(TurnkeySdkClient.name);
  private parentClient?: TurnkeyApiClient;
  private delegatedClient?: TurnkeyApiClient;

  constructor(private readonly config: ConfigService) {}

  /**
   * Signs with the parent organization's API key.
   *
   * Only creating a sub-organization goes through this. The parent is
   * read-only over its sub-organizations, so it cannot sign anything scoped to
   * one of them.
   */
  private get parent(): TurnkeyApiClient {
    this.parentClient ??= this.build(
      this.require('TURNKEY_API_PUBLIC_KEY'),
      this.require('TURNKEY_API_PRIVATE_KEY'),
    );
    return this.parentClient;
  }

  /**
   * Signs with the delegated key, which is the backend's root user inside each
   * sub-organization for the length of enrolment.
   *
   * Everything scoped to a sub-organization has to be signed by this rather
   * than by the parent key, because the parent is not a member of the sub-org's
   * quorum and its signature carries no authority there.
   */
  private get delegated(): TurnkeyApiClient {
    this.delegatedClient ??= this.build(
      this.require('TURNKEY_DELEGATED_PUBLIC_KEY'),
      this.require('TURNKEY_DELEGATED_PRIVATE_KEY'),
    );
    return this.delegatedClient;
  }

  private build(apiPublicKey: string, apiPrivateKey: string): TurnkeyApiClient {
    const defaultOrganizationId = this.require('TURNKEY_ORGANIZATION_ID');
    const apiBaseUrl = this.config.get<string>(
      'TURNKEY_API_BASE_URL',
      'https://api.turnkey.com',
    );

    this.logger.log(
      `turnkey.client.ready organizationId=${defaultOrganizationId}`,
    );
    return new Turnkey({
      apiBaseUrl,
      apiPublicKey,
      apiPrivateKey,
      defaultOrganizationId,
    }).apiClient();
  }

  async createSubOrganization(params: {
    subOrganizationName: string;
    rootUsers: TurnkeyRootUser[];
    rootQuorumThreshold: number;
    wallet: { walletName: string; accounts: unknown[] };
    disableEmailAuth: boolean;
    disableEmailRecovery: boolean;
    disableOtpEmailAuth: boolean;
    disableSmsAuth: boolean;
  }) {
    const result = await this.parent.createSubOrganization(
      params as Parameters<TurnkeyApiClient['createSubOrganization']>[0],
    );
    return {
      subOrganizationId: result.subOrganizationId,
      rootUserIds: result.rootUserIds,
      wallet: result.wallet,
    };
  }

  async updateRootQuorum(params: {
    organizationId: string;
    threshold: number;
    userIds: string[];
  }) {
    return this.delegated.updateRootQuorum(params);
  }

  async getRootQuorum(params: { organizationId: string }) {
    const { configs } = await this.delegated.getOrganizationConfigs(params);
    const quorum = configs?.quorum;

    // An absent quorum must not read as an empty one. Empty would look like a
    // successfully narrowed set to the caller checking the length.
    if (!quorum) {
      throw new TurnkeyUnavailableError(
        'Turnkey returned an organization config with no quorum',
      );
    }
    return { threshold: quorum.threshold, userIds: quorum.userIds };
  }

  private require(key: string): string {
    const value = this.config.get<string>(key);
    if (!value) {
      throw new TurnkeyUnavailableError(`${key} is not configured`);
    }
    return value;
  }
}

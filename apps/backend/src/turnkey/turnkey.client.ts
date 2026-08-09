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
  private cached?: TurnkeyApiClient;

  constructor(private readonly config: ConfigService) {}

  private get client(): TurnkeyApiClient {
    if (this.cached) return this.cached;

    const apiPublicKey = this.require('TURNKEY_API_PUBLIC_KEY');
    const apiPrivateKey = this.require('TURNKEY_API_PRIVATE_KEY');
    const defaultOrganizationId = this.require('TURNKEY_ORGANIZATION_ID');
    const apiBaseUrl = this.config.get<string>(
      'TURNKEY_API_BASE_URL',
      'https://api.turnkey.com',
    );

    this.cached = new Turnkey({
      apiBaseUrl,
      apiPublicKey,
      apiPrivateKey,
      defaultOrganizationId,
    }).apiClient();

    this.logger.log(
      `turnkey.client.ready organizationId=${defaultOrganizationId}`,
    );
    return this.cached;
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
    const result = await this.client.createSubOrganization(
      params as Parameters<TurnkeyApiClient['createSubOrganization']>[0],
    );
    return {
      subOrganizationId: result.subOrganizationId,
      rootUserIds: result.rootUserIds,
      wallet: result.wallet,
    };
  }

  async createPolicy(params: {
    organizationId: string;
    policyName: string;
    effect: 'EFFECT_ALLOW' | 'EFFECT_DENY';
    consensus: string;
    condition: string;
    notes: string;
  }) {
    const result = await this.client.createPolicy(params);
    return { policyId: result.policyId };
  }

  async updateRootQuorum(params: {
    organizationId: string;
    threshold: number;
    userIds: string[];
  }) {
    return this.client.updateRootQuorum(params);
  }

  async getRootQuorum(params: { organizationId: string }) {
    const { configs } = await this.client.getOrganizationConfigs(params);
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

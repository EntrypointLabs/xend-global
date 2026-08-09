import {
  ApprovalSignerShapeError,
  TurnkeyUnavailableError,
  UnsafeSubOrganizationError,
} from './turnkey.errors';
import { TurnkeyApi } from './turnkey.interface';
import { TurnkeyService } from './turnkey.service';

const DELEGATED_KEY = '02aa';
const DELEGATED_USER = 'user-delegated';
const CONSUMER_USER = 'user-consumer';
const SUB_ORG = 'suborg-1';
const SOLANA_ADDRESS = 'GkP9xL7mQwR2sT4vB6nH8jC3dF5aZ1yU2eW4rK6tN9pM';

type Calls = {
  createSubOrganization: Parameters<TurnkeyApi['createSubOrganization']>[0][];
  createPolicy: Parameters<TurnkeyApi['createPolicy']>[0][];
  updateRootQuorum: Parameters<TurnkeyApi['updateRootQuorum']>[0][];
};

function fakeApi(overrides: Partial<TurnkeyApi> = {}) {
  const calls: Calls = {
    createSubOrganization: [],
    createPolicy: [],
    updateRootQuorum: [],
  };

  // Mirrors the real service: the quorum only narrows once updateRootQuorum
  // succeeds, so a test that skips it reads the pre-narrowing quorum back.
  let quorum = { threshold: 1, userIds: [DELEGATED_USER, CONSUMER_USER] };

  const api: TurnkeyApi = {
    createSubOrganization(params) {
      calls.createSubOrganization.push(params);
      return Promise.resolve({
        subOrganizationId: SUB_ORG,
        rootUserIds: [DELEGATED_USER, CONSUMER_USER],
        wallet: { walletId: 'wallet-1', addresses: [SOLANA_ADDRESS] },
      });
    },
    createPolicy(params) {
      calls.createPolicy.push(params);
      return Promise.resolve({ policyId: 'policy-1' });
    },
    updateRootQuorum(params) {
      calls.updateRootQuorum.push(params);
      quorum = { threshold: params.threshold, userIds: params.userIds };
      return Promise.resolve({});
    },
    getRootQuorum() {
      return Promise.resolve(quorum);
    },
    ...overrides,
  };

  return { api, calls };
}

function service(api: TurnkeyApi) {
  return new TurnkeyService(api, DELEGATED_KEY);
}

describe('TurnkeyService.enrolApprovalSigner', () => {
  it('returns the sub-organization and its Solana address', async () => {
    const { api } = fakeApi();

    await expect(
      service(api).enrolApprovalSigner({
        reference: 'consumer-1',
        hardwarePublicKey: '03bb',
      }),
    ).resolves.toEqual({
      subOrganizationId: SUB_ORG,
      address: SOLANA_ADDRESS,
    });
  });

  it('disables every email and SMS unlock channel', async () => {
    const { api, calls } = fakeApi();

    await service(api).enrolApprovalSigner({
      reference: 'consumer-1',
      hardwarePublicKey: '03bb',
    });

    // Each of these defaults to on at Turnkey. Any one left on gives S2 an
    // inbox unlock, which is the anchor S3 already occupies.
    expect(calls.createSubOrganization[0]).toMatchObject({
      disableEmailAuth: true,
      disableEmailRecovery: true,
      disableOtpEmailAuth: true,
      disableSmsAuth: true,
    });
  });

  it('leaves only the consumer device key in the root quorum', async () => {
    const { api, calls } = fakeApi();

    await service(api).enrolApprovalSigner({
      reference: 'consumer-1',
      hardwarePublicKey: '03bb',
    });

    expect(calls.updateRootQuorum[0]).toEqual({
      organizationId: SUB_ORG,
      threshold: 1,
      userIds: [CONSUMER_USER],
    });
  });

  it('grants the delegated user policy authority and no signing authority', async () => {
    const { api, calls } = fakeApi();

    await service(api).enrolApprovalSigner({
      reference: 'consumer-1',
      hardwarePublicKey: '03bb',
    });

    const policy = calls.createPolicy[0];
    expect(policy.consensus).toContain(DELEGATED_USER);
    // The property that keeps a backend compromise below threshold: it can
    // change what S2 may sign, never sign as S2.
    expect(policy.condition).not.toMatch(/SIGN_/);
  });

  it('creates the policy before narrowing, because narrowing revokes the authority to create it', async () => {
    const order: string[] = [];
    const { api } = fakeApi();
    const tracked: TurnkeyApi = {
      ...api,
      createPolicy(params) {
        order.push('policy');
        return api.createPolicy(params);
      },
      updateRootQuorum(params) {
        order.push('narrow');
        return api.updateRootQuorum(params);
      },
    };

    await service(tracked).enrolApprovalSigner({
      reference: 'consumer-1',
      hardwarePublicKey: '03bb',
    });

    expect(order).toEqual(['policy', 'narrow']);
  });

  it('reports an unsafe sub-organization when narrowing fails', async () => {
    const { api } = fakeApi({
      updateRootQuorum() {
        return Promise.reject(new Error('turnkey 500'));
      },
    });

    // The backend is still a root user here, so this sub-org must never be
    // handed to a Consumer. The id rides along so the caller can delete it.
    await expect(
      service(api).enrolApprovalSigner({
        reference: 'consumer-1',
        hardwarePublicKey: '03bb',
      }),
    ).rejects.toMatchObject({
      code: 'UNSAFE_SUB_ORGANIZATION',
      subOrganizationId: SUB_ORG,
    });
  });

  it('reports an unsafe sub-organization when the quorum did not actually narrow', async () => {
    const { api } = fakeApi({
      // Succeeds, changes nothing. Exactly the case a non-throwing call hides.
      updateRootQuorum() {
        return Promise.resolve({});
      },
    });

    await expect(
      service(api).enrolApprovalSigner({
        reference: 'consumer-1',
        hardwarePublicKey: '03bb',
      }),
    ).rejects.toBeInstanceOf(UnsafeSubOrganizationError);
  });

  it('reports an unsafe sub-organization when policy creation fails', async () => {
    const { api } = fakeApi({
      createPolicy() {
        return Promise.reject(new Error('turnkey 500'));
      },
    });

    await expect(
      service(api).enrolApprovalSigner({
        reference: 'consumer-1',
        hardwarePublicKey: '03bb',
      }),
    ).rejects.toBeInstanceOf(UnsafeSubOrganizationError);
  });

  it('refuses to enrol without a hardware public key', async () => {
    const { api, calls } = fakeApi();

    await expect(
      service(api).enrolApprovalSigner({
        reference: 'consumer-1',
        hardwarePublicKey: '',
      }),
    ).rejects.toBeInstanceOf(ApprovalSignerShapeError);

    expect(calls.createSubOrganization).toHaveLength(0);
  });

  it('refuses to enrol when the delegated key is not configured', async () => {
    const { api, calls } = fakeApi();

    // The module reads this key rather than requiring it, so a backend with no
    // Turnkey credentials boots. The failure belongs here, at the call.
    await expect(
      new TurnkeyService(api, '').enrolApprovalSigner({
        reference: 'consumer-1',
        hardwarePublicKey: '03bb',
      }),
    ).rejects.toBeInstanceOf(ApprovalSignerShapeError);

    expect(calls.createSubOrganization).toHaveLength(0);
  });

  it('surfaces a creation failure as unavailable, not as an unsafe sub-org', async () => {
    const { api } = fakeApi({
      createSubOrganization() {
        return Promise.reject(new Error('turnkey 503'));
      },
    });

    // Nothing was created, so there is nothing to quarantine.
    await expect(
      service(api).enrolApprovalSigner({
        reference: 'consumer-1',
        hardwarePublicKey: '03bb',
      }),
    ).rejects.toBeInstanceOf(TurnkeyUnavailableError);
  });

  it('rejects a sub-organization that came back without a wallet address', async () => {
    const { api } = fakeApi({
      createSubOrganization() {
        return Promise.resolve({
          subOrganizationId: SUB_ORG,
          rootUserIds: [DELEGATED_USER, CONSUMER_USER],
        });
      },
    });

    await expect(
      service(api).enrolApprovalSigner({
        reference: 'consumer-1',
        hardwarePublicKey: '03bb',
      }),
    ).rejects.toBeInstanceOf(UnsafeSubOrganizationError);
  });
});

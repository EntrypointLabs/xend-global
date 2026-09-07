import type {
  ApprovalSignerRow,
  ApprovalSignerStore,
  NewApprovalSigner,
} from './approval-signer.store';
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
  updateRootQuorum: Parameters<TurnkeyApi['updateRootQuorum']>[0][];
  createPolicy: Parameters<TurnkeyApi['createPolicy']>[0][];
  /** Every call in the order Turnkey saw it. */
  order: string[];
};

function fakeApi(overrides: Partial<TurnkeyApi> = {}) {
  const calls: Calls = {
    createSubOrganization: [],
    updateRootQuorum: [],
    createPolicy: [],
    order: [],
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
    updateRootQuorum(params) {
      calls.updateRootQuorum.push(params);
      calls.order.push('updateRootQuorum');
      quorum = { threshold: params.threshold, userIds: params.userIds };
      return Promise.resolve({});
    },
    getRootQuorum() {
      return Promise.resolve(quorum);
    },
    createPolicy(params) {
      calls.createPolicy.push(params);
      calls.order.push('createPolicy');
      return Promise.resolve({
        policyId: `policy-${calls.createPolicy.length}`,
      });
    },
    ...overrides,
  };

  return { api, calls };
}

/** In-memory store. The reuse rule lives in the service, so this stays dumb. */
class FakeApprovalStore implements ApprovalSignerStore {
  rows: ApprovalSignerRow[] = [];
  private seq = 0;

  findByUserAndDevice(userId: string, hardwarePublicKey: string) {
    return Promise.resolve(
      this.rows.find(
        (r) => r.userId === userId && r.hardwarePublicKey === hardwarePublicKey,
      ) ?? null,
    );
  }

  listByUser(userId: string) {
    return Promise.resolve(this.rows.filter((r) => r.userId === userId));
  }

  findBySubOrganization(subOrganizationId: string) {
    return Promise.resolve(
      this.rows.find((r) => r.subOrganizationId === subOrganizationId) ?? null,
    );
  }

  insert(row: NewApprovalSigner) {
    const created = {
      id: `approval-${++this.seq}`,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      ...row,
    } as ApprovalSignerRow;
    this.rows.push(created);
    return Promise.resolve(created);
  }
}

function service(
  api: TurnkeyApi,
  store: ApprovalSignerStore = new FakeApprovalStore(),
  policiesEnabled = false,
) {
  return new TurnkeyService(api, DELEGATED_KEY, store, policiesEnabled);
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

  it('leaves the backend no standing authority over the sub-organization', async () => {
    const { api, calls } = fakeApi();

    await service(api).enrolApprovalSigner({
      reference: 'consumer-1',
      hardwarePublicKey: '03bb',
    });

    // The backend used to keep policy authority here, excluding every signing
    // activity. That reads safe and is not: whoever can write policies can
    // write one granting themselves the signing activities, and the backend
    // already holds S3, so one compromise reached threshold. Narrowing is now
    // the only thing enrolment leaves behind.
    expect(calls.updateRootQuorum[0].userIds).toEqual([CONSUMER_USER]);
    expect(calls.createPolicy).toEqual([]);
  });

  describe('with TURNKEY_POLICIES_ENABLED', () => {
    it('writes both policies inside the window, before narrowing', async () => {
      const { api, calls } = fakeApi();

      const enrolled = await service(
        api,
        new FakeApprovalStore(),
        true,
      ).enrolApprovalSigner({
        reference: 'consumer-1',
        hardwarePublicKey: '03bb',
      });

      expect(calls.order).toEqual([
        'createPolicy',
        'createPolicy',
        'updateRootQuorum',
      ]);
      expect(calls.createPolicy.map((p) => p.organizationId)).toEqual([
        SUB_ORG,
        SUB_ORG,
      ]);
      expect(calls.createPolicy.map((p) => p.effect)).toEqual([
        'EFFECT_ALLOW',
        'EFFECT_DENY',
      ]);
      // Every policy names the Consumer's user, never the backend's.
      expect(calls.createPolicy[0].consensus).toContain(CONSUMER_USER);
      expect(JSON.stringify(calls.createPolicy)).not.toContain(DELEGATED_USER);
      expect(enrolled.policyIds).toEqual(['policy-1', 'policy-2']);
    });

    it('records the policy ids on the sub-organization row', async () => {
      const { api } = fakeApi();
      const store = new FakeApprovalStore();

      await service(api, store, true).ensureApprovalSigner({
        reference: 'consumer-1',
        hardwarePublicKey: '03bb',
      });

      expect(store.rows[0].policyIds).toEqual(['policy-1', 'policy-2']);
    });

    it('reports an unsafe sub-organization when a policy write fails', async () => {
      const { api, calls } = fakeApi({
        createPolicy() {
          return Promise.reject(new Error('turnkey 400'));
        },
      });

      await expect(
        service(api, new FakeApprovalStore(), true).enrolApprovalSigner({
          reference: 'consumer-1',
          hardwarePublicKey: '03bb',
        }),
      ).rejects.toMatchObject({
        code: 'UNSAFE_SUB_ORGANIZATION',
        subOrganizationId: SUB_ORG,
      });
      expect(calls.updateRootQuorum).toEqual([]);
    });
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
      new TurnkeyService(api, '', new FakeApprovalStore()).enrolApprovalSigner({
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

describe('TurnkeyService.ensureApprovalSigner', () => {
  it('creates one sub-organization and records it', async () => {
    const { api, calls } = fakeApi();
    const store = new FakeApprovalStore();

    const enrolled = await service(api, store).ensureApprovalSigner({
      reference: 'consumer-1',
      hardwarePublicKey: '03bb',
    });

    expect(calls.createSubOrganization).toHaveLength(1);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].subOrganizationId).toBe(enrolled.subOrganizationId);
    expect(store.rows[0].hardwarePublicKey).toBe('03bb');
  });

  it('reuses the recorded sub-organization when enrolment is retried', async () => {
    const { api, calls } = fakeApi();
    const store = new FakeApprovalStore();
    const turnkey = service(api, store);

    const first = await turnkey.ensureApprovalSigner({
      reference: 'consumer-1',
      hardwarePublicKey: '03bb',
    });
    const second = await turnkey.ensureApprovalSigner({
      reference: 'consumer-1',
      hardwarePublicKey: '03bb',
    });

    // The retry must not mint a second sub-organization. The first one already
    // carries the Consumer's hardware key as its authenticator, and creating
    // another strands it at Turnkey with nothing referencing it.
    expect(calls.createSubOrganization).toHaveLength(1);
    expect(store.rows).toHaveLength(1);
    expect(second.subOrganizationId).toBe(first.subOrganizationId);
    expect(second.address).toBe(first.address);
  });

  it('enrols a new sub-organization for a replacement device', async () => {
    const { api, calls } = fakeApi();
    const store = new FakeApprovalStore();
    const turnkey = service(api, store);

    await turnkey.ensureApprovalSigner({
      reference: 'consumer-1',
      hardwarePublicKey: '03bb',
    });
    await turnkey.ensureApprovalSigner({
      reference: 'consumer-1',
      hardwarePublicKey: '03cc',
    });

    // The sub-org's only authenticator is the hardware key it was created
    // with, so handing the old one back would give the new device an S2 it
    // holds no key for.
    expect(calls.createSubOrganization).toHaveLength(2);
    expect(store.rows).toHaveLength(2);
  });

  it('records nothing when the sequence fails before narrowing', async () => {
    const { api, calls } = fakeApi({
      updateRootQuorum: () => Promise.reject(new Error('turnkey is down')),
    });
    const store = new FakeApprovalStore();

    await expect(
      service(api, store).ensureApprovalSigner({
        reference: 'consumer-1',
        hardwarePublicKey: '03bb',
      }),
    ).rejects.toBeTruthy();

    // A sub-org recorded mid-sequence would be handed back by the next retry
    // with the backend still a root user on it, which is the state enrolment
    // refuses to return.
    expect(calls.createSubOrganization).toHaveLength(1);
    expect(store.rows).toHaveLength(0);
  });
});

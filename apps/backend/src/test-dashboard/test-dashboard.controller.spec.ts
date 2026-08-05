import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { KeyIssuanceService } from '../merchant/key-issuance.service';
import { TestDashboardController } from './test-dashboard.controller';
import { TestDashboardGuard } from './test-dashboard.guard';
import type { TestDashboardService } from './test-dashboard.service';

function makeConfig(nodeEnv: string | undefined): ConfigService {
  return { get: () => nodeEnv } as unknown as ConfigService;
}

function makeRes(): {
  res: Response;
  send: jest.Mock<void, [string]>;
  redirect: jest.Mock;
} {
  const send = jest.fn<void, [string]>();
  const redirect = jest.fn();
  const res = {
    type: jest.fn().mockReturnThis(),
    send,
    redirect,
  } as unknown as Response;
  return { res, send, redirect };
}

describe('TestDashboardGuard', () => {
  it('404s outside development (production)', () => {
    const guard = new TestDashboardGuard(makeConfig('production'));
    expect(() => guard.canActivate()).toThrow(NotFoundException);
  });

  it('404s outside development (test)', () => {
    const guard = new TestDashboardGuard(makeConfig('test'));
    expect(() => guard.canActivate()).toThrow(NotFoundException);
  });

  it('allows development', () => {
    const guard = new TestDashboardGuard(makeConfig('development'));
    expect(guard.canActivate()).toBe(true);
  });
});

describe('TestDashboardController', () => {
  let dashboard: {
    createMerchant: jest.Mock;
    listTestMerchants: jest.Mock;
  };
  let keyIssuance: { issueKey: jest.Mock; markKybVerified: jest.Mock };
  let controller: TestDashboardController;

  beforeEach(() => {
    dashboard = {
      createMerchant: jest
        .fn()
        .mockResolvedValue({ id: 'm_1', kybStatus: 'pending' }),
      listTestMerchants: jest.fn().mockResolvedValue([]),
    };
    keyIssuance = {
      issueKey: jest.fn().mockResolvedValue({
        raw: 'xnd_test_raw1234',
        fingerprint: 'xnd_test_...1234',
      }),
      markKybVerified: jest.fn().mockResolvedValue(undefined),
    };
    controller = new TestDashboardController(
      dashboard as unknown as TestDashboardService,
      keyIssuance as unknown as KeyIssuanceService,
    );
  });

  it('creates a merchant and shows the raw test key exactly once', async () => {
    const { res, send } = makeRes();
    await controller.createMerchant('  Cafe Neo  ', res);

    expect(dashboard.createMerchant).toHaveBeenCalledWith('Cafe Neo');
    expect(keyIssuance.issueKey).toHaveBeenCalledWith('m_1', 'test');

    const html = send.mock.calls[0][0];
    expect(html).toContain('xnd_test_raw1234');
    expect(html).toContain('m_1');
    expect(html).toContain('TEST MODE');
    expect(html).toContain('shown once');
    expect(html).toContain('Mark KYB verified (stub)');
  });

  it('rejects an empty business name', async () => {
    const { res } = makeRes();
    await expect(controller.createMerchant('   ', res)).rejects.toThrow(
      BadRequestException,
    );
    expect(dashboard.createMerchant).not.toHaveBeenCalled();
    expect(keyIssuance.issueKey).not.toHaveBeenCalled();
  });

  it('flips KYB via the shared service and redirects back', async () => {
    const { res, redirect } = makeRes();
    await controller.markKybVerified('m_1', res);
    expect(keyIssuance.markKybVerified).toHaveBeenCalledWith('m_1');
    expect(redirect).toHaveBeenCalledWith(303, '/test-dashboard');
  });

  it('renders the index with the create form and test-mode rows', async () => {
    dashboard.listTestMerchants.mockResolvedValue([
      {
        merchantId: 'm_1',
        displayName: 'Cafe Neo',
        fingerprint: 'xnd_test_...1234',
        mode: 'test',
        kybStatus: 'pending',
      },
    ]);
    const { res, send } = makeRes();
    await controller.index(res);

    const html = send.mock.calls[0][0];
    expect(html).toContain('Create test business');
    expect(html).toContain('Cafe Neo');
    expect(html).toContain('xnd_test_...1234');
    expect(html).toContain('pending');
  });
});

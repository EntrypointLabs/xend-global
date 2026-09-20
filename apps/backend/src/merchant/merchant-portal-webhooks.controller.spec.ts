import { HttpException, NotFoundException } from '@nestjs/common';
import type { DbService } from '../db/db.service';
import type { MerchantAuditService } from './merchant-audit.service';
import type { MerchantOwnerService } from './merchant-owner.service';
import type { WebhookEndpointService } from '../webhook/webhook-endpoint.service';
import { UnsafeUrlError } from '../common/url-safety';
import { WebhookEndpointNotFoundError } from '../webhook/webhook.errors';
import { MerchantPortalWebhooksController } from './merchant-portal-webhooks.controller';

const merchant = {
  id: 'm1',
  ownerProviderId: 'owner-1',
  signInEmail: null,
} as never;

function endpointRow(over: Record<string, unknown> = {}) {
  return {
    id: 'wh1',
    merchantId: 'm1',
    url: 'https://example.com/hook',
    secretPrimary: 'whsec_secret',
    secretSecondary: null,
    secondaryExpiresAt: null,
    enabled: true,
    eventTypes: null,
    mode: 'test',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...over,
  };
}

function setup(over: Partial<Record<string, jest.Mock>> = {}) {
  const record = jest.fn().mockResolvedValue(undefined);
  const owner = {
    owned: jest.fn().mockResolvedValue(merchant),
  } as unknown as MerchantOwnerService;
  const mocks = {
    list: over.list ?? jest.fn().mockResolvedValue([endpointRow()]),
    register:
      over.register ??
      jest
        .fn()
        .mockResolvedValue({ endpoint: endpointRow(), secret: 'whsec_new' }),
    rotateSecret:
      over.rotateSecret ??
      jest.fn().mockResolvedValue({
        secret: 'whsec_rotated',
        secondaryExpiresAt: new Date('2026-02-01'),
      }),
    find: over.find ?? jest.fn().mockResolvedValue(endpointRow()),
    disable: over.disable ?? jest.fn().mockResolvedValue(endpointRow()),
  };
  const client = { select: jest.fn() };
  const controller = new MerchantPortalWebhooksController(
    { client } as unknown as DbService,
    owner,
    mocks as unknown as WebhookEndpointService,
    { record } as unknown as MerchantAuditService,
  );
  return { controller, owner, record, client, ...mocks };
}

describe('MerchantPortalWebhooksController', () => {
  it('creates an endpoint scoped to the authenticated owner and returns the secret once', async () => {
    const { controller, register, record } = setup();
    const result = await controller.create('Bearer t', {
      url: 'https://example.com/hook',
      mode: 'test',
      eventTypes: null,
    });
    expect(register).toHaveBeenCalledWith({
      merchantId: 'm1',
      mode: 'test',
      url: 'https://example.com/hook',
      eventTypes: null,
    });
    expect(result.secret).toBe('whsec_new');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'webhook.create', merchantId: 'm1' }),
    );
  });

  it('never exposes a stored secret on a list read', async () => {
    const { controller } = setup();
    const result = await controller.list('Bearer t');
    expect(result.endpoints[0]).not.toHaveProperty('secretPrimary');
    expect(result.endpoints[0]).not.toHaveProperty('secret');
  });

  it('maps an unsafe URL to 422', async () => {
    const { controller } = setup({
      register: jest.fn().mockRejectedValue(new UnsafeUrlError('private')),
    });
    await expect(
      controller.create('Bearer t', {
        url: 'https://10.0.0.1/hook',
        mode: 'test',
        eventTypes: null,
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('rotates the secret and hands back the grace-window expiry', async () => {
    const { controller, record } = setup();
    const result = await controller.rotate('Bearer t', 'wh1');
    expect(result.secret).toBe('whsec_rotated');
    expect(result.previousSecretExpiresAt).toBe('2026-02-01T00:00:00.000Z');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'webhook.rotate_secret' }),
    );
  });

  it('checks endpoint ownership before reading its delivery history', async () => {
    const find = jest
      .fn()
      .mockRejectedValue(new WebhookEndpointNotFoundError('nope'));
    const { controller, client } = setup({ find });
    await expect(controller.deliveries('Bearer t', 'other')).rejects.toThrow(
      NotFoundException,
    );
    expect(find).toHaveBeenCalledWith('other', { merchantId: 'm1' });
    expect(client.select).not.toHaveBeenCalled();
  });
});

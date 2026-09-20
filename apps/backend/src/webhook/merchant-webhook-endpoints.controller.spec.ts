import type { DbService } from '../db/db.service';
import type { MerchantAuditService } from '../merchant/merchant-audit.service';
import type { MerchantRequest } from '../merchant/api-key.guard';
import { MerchantWebhookEndpointsController } from './merchant-webhook-endpoints.controller';
import type { WebhookEndpointService } from './webhook-endpoint.service';

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

function req(): MerchantRequest {
  return {
    merchant: {
      merchantId: 'm1',
      apiKeyId: 'ak_123',
      mode: 'test',
      executionCluster: null,
      deliveryMode: 'test',
    },
  } as unknown as MerchantRequest;
}

function setup(over: Partial<Record<string, jest.Mock>> = {}) {
  const record = jest.fn().mockResolvedValue(undefined);
  const mocks = {
    assertUrlSafe: over.assertUrlSafe ?? jest.fn().mockResolvedValue(undefined),
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
    disable:
      over.disable ??
      jest.fn().mockResolvedValue({ endpoint: endpointRow(), claimed: true }),
  };
  const client = {
    transaction: (cb: (tx: unknown) => unknown) => cb({}),
  };
  const controller = new MerchantWebhookEndpointsController(
    mocks as unknown as WebhookEndpointService,
    { client } as unknown as DbService,
    { record } as unknown as MerchantAuditService,
  );
  return { controller, record, ...mocks };
}

describe('MerchantWebhookEndpointsController audit trail', () => {
  it('records a create attributed to the API key', async () => {
    const { controller, register, record } = setup();
    const result = await controller.create(req(), {
      url: 'https://example.com/hook',
      event_types: null,
    });
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: 'm1', mode: 'test' }),
      expect.anything(),
      { skipUrlCheck: true },
    );
    expect(result.secret).toBe('whsec_new');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'webhook.create',
        merchantId: 'm1',
        actor: 'api_key:ak_123',
      }),
      expect.anything(),
    );
  });

  it('records a secret rotation attributed to the API key', async () => {
    const { controller, record } = setup();
    const result = await controller.rotateSecret(req(), 'wh1');
    expect(result.secret).toBe('whsec_rotated');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'webhook.rotate_secret',
        actor: 'api_key:ak_123',
      }),
      expect.anything(),
    );
  });

  it('records a delete only when the request actually disabled the endpoint', async () => {
    const { controller, record } = setup();
    await controller.remove(req(), 'wh1');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'webhook.delete',
        actor: 'api_key:ak_123',
      }),
      expect.anything(),
    );
  });

  it('does not audit a no-op delete of an already-disabled endpoint', async () => {
    const { controller, record } = setup({
      disable: jest
        .fn()
        .mockResolvedValue({ endpoint: endpointRow(), claimed: false }),
    });
    await controller.remove(req(), 'wh1');
    expect(record).not.toHaveBeenCalled();
  });
});

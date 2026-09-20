import type { ConfigService } from '@nestjs/config';
import type { DbService } from '../db/db.service';
import { WebhookEndpointService } from './webhook-endpoint.service';
import { WebhookSecretRotationConflictError } from './webhook.errors';

const endpoint = {
  id: 'wh1',
  merchantId: 'm1',
  url: 'https://example.com/hook',
  secretPrimary: 'whsec_old',
  secretSecondary: null,
  secondaryExpiresAt: null,
  enabled: true,
  eventTypes: null,
  mode: 'test',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

function makeService(updateReturns: unknown[]) {
  let captured: unknown;
  const client = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([endpoint]) }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: (condition: unknown) => {
          captured = condition;
          return { returning: () => Promise.resolve(updateReturns) };
        },
      }),
    }),
  };
  const config = {
    get: () => undefined,
  } as unknown as ConfigService;
  const service = new WebhookEndpointService(
    { client } as unknown as DbService,
    config,
  );
  return { service, getCaptured: () => captured };
}

describe('WebhookEndpointService.rotateSecret', () => {
  it('rotates when the primary is unchanged', async () => {
    const { service } = makeService([{ id: 'wh1' }]);
    const result = await service.rotateSecret('wh1', { merchantId: 'm1' });
    expect(result.secret).toMatch(/^whsec_/);
    expect(result.secondaryExpiresAt).toBeInstanceOf(Date);
  });

  it('reports a conflict when a concurrent rotation already changed the primary', async () => {
    // The conditional update matches no row because the primary the caller read
    // is no longer current, so the loser is refused instead of clobbering the
    // winner's freshly issued secret.
    const { service } = makeService([]);
    await expect(
      service.rotateSecret('wh1', { merchantId: 'm1' }),
    ).rejects.toBeInstanceOf(WebhookSecretRotationConflictError);
  });
});

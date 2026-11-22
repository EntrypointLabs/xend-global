import type { ConfigService } from '@nestjs/config';
import type { DbService } from '../db/db.service';
import { iconLinksIn, MerchantLogoService } from './merchant-logo.service';

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);

function service(): { svc: MerchantLogoService; writes: unknown[] } {
  const writes: unknown[] = [];
  const db = {
    client: {
      insert: () => ({
        values: (v: unknown) => ({
          onConflictDoUpdate: () => {
            writes.push(v);
            return Promise.resolve();
          },
        }),
      }),
    },
  } as unknown as DbService;
  const config = { get: () => undefined } as unknown as ConfigService;
  return { svc: new MerchantLogoService(db, config), writes };
}

describe('MerchantLogoService.upload', () => {
  it('stores a real PNG', async () => {
    const { svc, writes } = service();
    await svc.upload('m_1', 'image/png', PNG);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ merchantId: 'm_1', source: 'upload' });
  });

  it('refuses a type the phone cannot draw', async () => {
    const { svc } = service();
    await expect(
      svc.upload('m_1', 'image/svg+xml', Buffer.from('<svg/>')),
    ).rejects.toMatchObject({ code: 'LOGO_TYPE_UNSUPPORTED' });
  });

  it('refuses a file that is not the type it claims', async () => {
    const { svc } = service();
    await expect(
      svc.upload('m_1', 'image/png', Buffer.from('not a png at all')),
    ).rejects.toMatchObject({ code: 'LOGO_TYPE_UNSUPPORTED' });
  });

  it('refuses anything over 256 KB', async () => {
    const { svc } = service();
    const big = Buffer.concat([PNG, Buffer.alloc(256 * 1024)]);
    await expect(svc.upload('m_1', 'image/png', big)).rejects.toMatchObject({
      code: 'LOGO_TOO_LARGE',
    });
  });
});

describe('MerchantLogoService.logoUrl', () => {
  it('versions the URL so a new upload is not hidden by caches', () => {
    const { svc } = service();
    expect(svc.logoUrl('m_1', new Date(1000))).toBe(
      'https://api.prydd.co/v1/merchant-logos/m_1?v=1000',
    );
    expect(svc.logoUrl('m_1', null)).toBe(
      'https://api.prydd.co/v1/merchant-logos/m_1',
    );
  });
});

describe('iconLinksIn', () => {
  it('prefers the apple touch icon, resolves relative paths and skips SVG', () => {
    const html = `
      <link rel="icon" href="/favicon.svg">
      <link rel="icon" type="image/png" href="/icon-32.png">
      <link rel="apple-touch-icon" href="/apple.png">`;
    expect(iconLinksIn(html, 'https://shop.prydd.co')).toEqual([
      'https://shop.prydd.co/apple.png',
      'https://shop.prydd.co/icon-32.png',
    ]);
  });
});

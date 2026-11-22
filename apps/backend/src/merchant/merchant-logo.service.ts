import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { merchantLogos, merchants } from '../db/schema';
import { assertPublicHttpsUrl } from '../common/url-safety';
import { merchantLogoUrl } from './merchant-logo.url';

export const MAX_LOGO_BYTES = 256 * 1024;

export const UPLOADABLE_LOGO_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;
export type UploadableLogoType = (typeof UPLOADABLE_LOGO_TYPES)[number];

/** Image types the phone can draw. SVG is left out: React Native's Image cannot. */
const DRAWABLE_TYPES = new Set<string>([
  ...UPLOADABLE_LOGO_TYPES,
  'image/gif',
  'image/x-icon',
  'image/vnd.microsoft.icon',
]);

/** How long a found (or not found) site icon is trusted before looking again. */
const SITE_ICON_TTL_MS = 24 * 60 * 60 * 1000;
const SITE_FETCH_TIMEOUT_MS = 3_000;
/** A home page or icon larger than this is not read at all. */
const MAX_SITE_BYTES = MAX_LOGO_BYTES * 4;

/**
 * Reads a body chunk by chunk and abandons it the moment it passes `limit`, so
 * a store that streams without a length cannot make the server buffer it all.
 */
export async function readCapped(
  res: Response,
  limit: number,
): Promise<Buffer | null> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > limit) {
    await res.body?.cancel();
    return null;
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export interface Logo {
  contentType: string;
  data: Buffer;
}

export class LogoTooLargeError extends Error {
  readonly code = 'LOGO_TOO_LARGE';
}
export class LogoTypeUnsupportedError extends Error {
  readonly code = 'LOGO_TYPE_UNSUPPORTED';
}

/** The first bytes of each uploadable type, so a renamed file cannot pass. */
function matchesSignature(type: UploadableLogoType, data: Buffer): boolean {
  switch (type) {
    case 'image/png':
      return data
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/jpeg':
      return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
    case 'image/webp':
      return (
        data.subarray(0, 4).toString('ascii') === 'RIFF' &&
        data.subarray(8, 12).toString('ascii') === 'WEBP'
      );
  }
}

/** `<link rel="...icon..." href="...">` targets on a store's home page, best first. */
export function iconLinksIn(html: string, base: string): string[] {
  const links: { href: string; rank: number }[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase();
    const href = /\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1];
    if (!rel || !href || !rel.includes('icon')) continue;
    if (/\.svg(\?|$)/i.test(href)) continue;
    const rank = rel.includes('apple-touch-icon') ? 0 : 1;
    try {
      links.push({ href: new URL(href, base).toString(), rank });
    } catch {
      // An unparseable href is not an icon we can use.
    }
  }
  return links.sort((a, b) => a.rank - b.rank).map((l) => l.href);
}

/**
 * Where a Merchant's logo comes from and how the app reaches it.
 *
 * An uploaded logo always wins. Without one, the icon on the Merchant's own
 * store is used, found from its first registered origin. Origins are written
 * by the Merchant, so every fetch is held to public HTTPS and never follows a
 * redirect, the same posture as webhook delivery.
 */
@Injectable()
export class MerchantLogoService {
  private readonly logger = new Logger(MerchantLogoService.name);
  /** One site lookup per Merchant at a time, however many requests arrive. */
  private readonly lookups = new Map<string, Promise<Logo | null>>();

  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
  ) {}

  logoUrl(merchantId: string, updatedAt?: Date | null): string {
    return merchantLogoUrl(
      this.config.get<string>('PUBLIC_API_URL'),
      merchantId,
      updatedAt,
    );
  }

  async upload(
    merchantId: string,
    contentType: string,
    data: Buffer,
  ): Promise<Date> {
    if (!(UPLOADABLE_LOGO_TYPES as readonly string[]).includes(contentType)) {
      throw new LogoTypeUnsupportedError(
        'Logos must be PNG, JPEG or WebP images.',
      );
    }
    if (data.length > MAX_LOGO_BYTES) {
      throw new LogoTooLargeError('Logos must be 256 KB or smaller.');
    }
    if (!matchesSignature(contentType as UploadableLogoType, data)) {
      throw new LogoTypeUnsupportedError(
        'That file is not the image type it claims to be.',
      );
    }
    const updatedAt = new Date();
    await this.db.client
      .insert(merchantLogos)
      .values({ merchantId, source: 'upload', contentType, data, updatedAt })
      .onConflictDoUpdate({
        target: merchantLogos.merchantId,
        set: { source: 'upload', contentType, data, updatedAt },
      });
    return updatedAt;
  }

  async remove(merchantId: string): Promise<void> {
    await this.db.client
      .delete(merchantLogos)
      .where(eq(merchantLogos.merchantId, merchantId));
  }

  /** When the logo last changed and where it came from, for the portal. */
  async describe(
    merchantId: string,
  ): Promise<{ updatedAt: Date | null; source: 'upload' | 'site' | null }> {
    const [row] = await this.db.client
      .select({
        updatedAt: merchantLogos.updatedAt,
        source: merchantLogos.source,
        hasData: merchantLogos.data,
      })
      .from(merchantLogos)
      .where(eq(merchantLogos.merchantId, merchantId))
      .limit(1);
    if (!row) return { updatedAt: null, source: null };
    // A site row with no image only records that the store had no icon.
    const source = row.source === 'site' && !row.hasData ? null : row.source;
    return { updatedAt: row.updatedAt, source };
  }

  /** The image to serve, or null when there is neither an upload nor a usable site icon. */
  async read(merchantId: string): Promise<Logo | null> {
    const [row] = await this.db.client
      .select()
      .from(merchantLogos)
      .where(eq(merchantLogos.merchantId, merchantId))
      .limit(1);
    if (row?.source === 'upload' && row.data && row.contentType) {
      return { contentType: row.contentType, data: row.data };
    }
    const fresh =
      row && Date.now() - row.updatedAt.getTime() < SITE_ICON_TTL_MS;
    if (fresh) {
      return row.data && row.contentType
        ? { contentType: row.contentType, data: row.data }
        : null;
    }

    const [merchant] = await this.db.client
      .select({ allowedOrigins: merchants.allowedOrigins })
      .from(merchants)
      .where(eq(merchants.id, merchantId))
      .limit(1);
    if (!merchant) return null;

    let lookup = this.lookups.get(merchantId);
    if (!lookup) {
      lookup = this.findSiteIcon(merchant.allowedOrigins ?? []).finally(() =>
        this.lookups.delete(merchantId),
      );
      this.lookups.set(merchantId, lookup);
    }
    const found = await lookup;
    const values = {
      merchantId,
      source: 'site' as const,
      contentType: found?.contentType ?? null,
      data: found?.data ?? null,
      updatedAt: new Date(),
    };
    // Never overwrite an upload that landed while the site was being read.
    await this.db.client
      .insert(merchantLogos)
      .values(values)
      .onConflictDoUpdate({
        target: merchantLogos.merchantId,
        set: values,
        setWhere: eq(merchantLogos.source, 'site'),
      });
    return found;
  }

  private async findSiteIcon(origins: string[]): Promise<Logo | null> {
    const origin = origins.find((o) => o.startsWith('https://'));
    if (!origin) return null;
    const candidates: string[] = [];
    const home = await this.fetchSafely(origin);
    if (home && /text\/html/i.test(home.contentType)) {
      candidates.push(...iconLinksIn(home.data.toString('utf8'), origin));
    }
    candidates.push(`${origin}/apple-touch-icon.png`, `${origin}/favicon.ico`);

    for (const url of [...new Set(candidates)]) {
      const icon = await this.fetchSafely(url);
      const type = icon?.contentType.split(';')[0].trim().toLowerCase();
      if (icon && type && DRAWABLE_TYPES.has(type) && icon.data.length > 0) {
        return { contentType: type, data: icon.data };
      }
    }
    return null;
  }

  private async fetchSafely(url: string): Promise<Logo | null> {
    try {
      await assertPublicHttpsUrl(url, {
        allowPrivate:
          this.config.get<boolean>('WEBHOOK_ALLOW_PRIVATE_URLS') ?? false,
      });
      const res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(SITE_FETCH_TIMEOUT_MS),
        headers: { accept: 'text/html,image/*;q=0.9' },
      });
      if (res.status !== 200) return null;
      const data = await readCapped(res, MAX_SITE_BYTES);
      if (!data) return null;
      return { contentType: res.headers.get('content-type') ?? '', data };
    } catch (err) {
      this.logger.debug(
        `merchant_logo.site_fetch_skipped url=${url} reason=${(err as Error).message}`,
      );
      return null;
    }
  }
}

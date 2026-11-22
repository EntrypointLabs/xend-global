/** A stable logo URL for the app, versioned so a new upload is not hidden by caches. */
export function merchantLogoUrl(
  publicApiUrl: string | undefined,
  merchantId: string,
  updatedAt?: Date | null,
): string {
  const base = (publicApiUrl ?? 'https://api.prydd.co').replace(/\/$/, '');
  const version = updatedAt ? `?v=${updatedAt.getTime()}` : '';
  return `${base}/v1/merchant-logos/${encodeURIComponent(merchantId)}${version}`;
}

import type { NextFunction, Request, Response } from 'express';

/**
 * Marks every API response as uncacheable.
 *
 * Express turns on ETags by default and sends no `Cache-Control`, which makes
 * authenticated JSON conditionally cacheable by URL alone. Two consequences,
 * and the second is the serious one:
 *
 * - A revalidated request comes back `304` with no body. The client treats a
 *   bodyless response as a failed one, so a perfectly good request surfaces as
 *   an error.
 * - The cache is keyed on the URL, not the bearer token. A device that signs
 *   out of one Consumer and into another can revalidate the first Consumer's
 *   cached response and be handed it, because `/account/recovery` is the same
 *   URL for everybody.
 *
 * Nothing this API returns is worth caching: every response is per-Consumer and
 * most of it is money or key material.
 */
export function noStoreMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  next();
}

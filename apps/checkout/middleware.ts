import { next } from '@vercel/functions';
import { frameAncestorFor } from './functions/_middleware.js';

export const config = { matcher: '/((?!assets/|api/|pay/assets/|pay/api/).*)' };

/**
 * The checkout may only be framed by the merchant the intent belongs to, as
 * reported by the API. Everything else keeps the default deny.
 */
export default async function middleware(request: Request) {
  const origin = await frameAncestorFor(request, process.env.CHECKOUT_API_BASE);
  return next({
    headers: origin
      ? { 'Content-Security-Policy': `frame-ancestors ${origin}` }
      : {
          'Content-Security-Policy': "frame-ancestors 'none'",
          'X-Frame-Options': 'DENY',
        },
  });
}

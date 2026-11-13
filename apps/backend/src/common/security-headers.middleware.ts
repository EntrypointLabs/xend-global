import type { NextFunction, Request, Response } from 'express';

export interface SecurityHeadersOptions {
  /**
   * Emit Strict-Transport-Security. Enable only where every response is served
   * over TLS (production behind the TLS-terminating proxy); a browser ignores
   * the header over plain HTTP, so it is off by default for local development.
   */
  hsts: boolean;
}

/**
 * Baseline security headers for the API surface. Deliberately narrow: this is a
 * JSON API, so it hardens content sniffing and referrer leakage and refuses
 * framing, and it does NOT set a Content-Security-Policy or touch
 * frame-ancestors — the checkout surface owns its own per-merchant framing
 * policy, and a blanket CSP here would fight it. The public checkout-intent
 * summary is read cross-origin under CORS, which these headers do not affect.
 */
export function securityHeadersMiddleware(options: SecurityHeadersOptions) {
  const hstsValue = 'max-age=31536000; includeSubDomains';
  return function securityHeaders(
    _req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (options.hsts) res.setHeader('Strict-Transport-Security', hstsValue);
    next();
  };
}

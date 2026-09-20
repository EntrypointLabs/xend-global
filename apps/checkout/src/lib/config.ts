/**
 * The intended relying party, matching mobile enrollment. These constants do
 * not configure Privy's web SDK: it uses the server-returned rp.id. Verify the
 * actual browser request before assuming subdomain Checkout compatibility.
 */
export const RP_ID = 'xend.global';
export const RP_ORIGIN = 'https://xend.global';

/**
 * Base URL for the checkout HTTP endpoints. In production this is a same-origin
 * /api path so the HttpOnly session cookie stays scoped to pay.xend.global.
 */
export const API_BASE = import.meta.env.VITE_API_BASE ?? '';

/** Public Privy app id. Public value, never a secret. */
export const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID ?? '';

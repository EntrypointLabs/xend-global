/**
 * The explicit relying party for every credential ceremony. rp.id resolves to
 * the registrable root xend.global, mirroring apps/mobile/hooks/usePasskey.ts,
 * so app-enrolled passkeys work on pay.xend.global. Never default rp.id to the
 * popup origin.
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

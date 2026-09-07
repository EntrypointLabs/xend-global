const ONE_MINUTE_MS = 60_000;

/**
 * Named throttles registered app-wide. `default` applies to every route;
 * `auth` is the tighter budget for credential-bearing surfaces (opt in per
 * controller with `@Throttle({ auth: THROTTLE_LIMITS.auth })`).
 */
export const THROTTLE_LIMITS = {
  default: { ttl: ONE_MINUTE_MS, limit: 300 },
  auth: { ttl: ONE_MINUTE_MS, limit: 20 },
} as const;

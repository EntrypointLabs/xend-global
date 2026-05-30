/**
 * Mobile feature flags.
 *
 * Read from `EXPO_PUBLIC_*` env vars at runtime. These ship to the device, so
 * never put anything sensitive here (no API keys, no secrets) — flags are
 * deployment-time toggles for behaviour, not for trust.
 *
 * See PROJECT.md core essence: "no provider API key shipped to the Expo
 * runtime." The flag below gates the cutover from the old Grid stack to the
 * new provider-neutral stack; it is itself non-sensitive.
 */

/**
 * Whether mobile should use the new (post-Grid) backend stack: Privy SDK on
 * device, single NestJS backend over HTTPS, no BFF, no Grid SDK.
 *
 * Defaults to `false`. Set `EXPO_PUBLIC_USE_NEW_STACK=true` in env to enable.
 *
 * Lifecycle:
 *   - Phase 0 (now): flag exists, default false, nothing reads it yet.
 *   - Phases 1-3: new backend stack is built behind the flag (still default false).
 *   - Phase 4: mobile cutover lands; in dev/staging the flag is flipped to true.
 *   - Phase 5: BFF and Grid SDK deleted; the flag becomes dead code and is
 *     removed in the same PR that deletes the old code paths.
 */
export function useNewStack(): boolean {
  return process.env.EXPO_PUBLIC_USE_NEW_STACK === 'true';
}

/**
 * Runs a passkey ceremony, absorbing one empty answer from the provider.
 *
 * Privy intermittently answers its first ceremony call with an empty body,
 * which surfaces as a JSON parse error before any credential exists. A single
 * retry covers it; a second failure is reported rather than looped.
 *
 * Sign-in only. A retry after registration would create a second credential
 * on the platform that no account knows about, so callers that register pass
 * nothing for `beforeRetry` and get no retry at all.
 */
export async function authenticateWithRetry<T>(
  authenticate: () => Promise<T>,
  beforeRetry?: () => Promise<void>
): Promise<T> {
  try {
    return await authenticate();
  } catch (err) {
    if (!beforeRetry || !(err instanceof SyntaxError)) throw err;
    if (__DEV__)
      console.warn("[passkey] empty ceremony response; retrying once");
    await beforeRetry();
    return authenticate();
  }
}

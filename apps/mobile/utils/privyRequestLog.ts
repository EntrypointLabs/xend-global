/**
 * Logs what Privy's API actually said, in development only.
 *
 * The SDK reports several unrelated problems as "Invalid request": a relying
 * party it will not accept, an app identifier that is not on the allowlist, a
 * client id that does not match the app. The response body distinguishes them
 * and never reaches the thrown error, so the only way to read it is here, on
 * the way past.
 *
 * Bodies are logged whole. They carry no session material: the passkey ceremony
 * is a WebAuthn challenge and its attestation, and a Privy token would be in a
 * header rather than a body. If that stops being true, this has to stop
 * printing bodies.
 */
export function installPrivyRequestLog() {
  if (!__DEV__) return;

  const original = globalThis.fetch;
  if ((original as { __privyLogged?: boolean }).__privyLogged) return;

  const patched: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (!url.includes("privy.io")) return original(input, init);

    const response = await original(input, init);
    if (response.ok) return response;

    // Read from a clone: a body can only be consumed once, and the caller
    // still needs it.
    const body = await response
      .clone()
      .text()
      .catch(() => "<unreadable>");
    console.warn(
      `[privy] ${init?.method ?? "GET"} ${url} -> ${response.status}`,
      body.slice(0, 2000)
    );
    return response;
  };

  (patched as { __privyLogged?: boolean }).__privyLogged = true;
  globalThis.fetch = patched;
}

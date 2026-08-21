/**
 * Logs what Privy's API actually said, in development only.
 *
 * The SDK reports several unrelated problems as "Invalid request": a relying
 * party it will not accept, an app identifier that is not on the allowlist, a
 * client id that does not match the app. The response body distinguishes them
 * and never reaches the thrown error, so the only way to read it is here, on
 * the way past.
 *
 * The passkey ceremony is logged in both directions, including on success,
 * because a registration can only be judged by comparing the challenge Privy
 * issued against the one the authenticator signed — and the request carries
 * the only copy of the latter.
 *
 * Bodies are logged whole. They carry no session material: the ceremony is a
 * WebAuthn challenge and its attestation, and a Privy token would be in a
 * header rather than a body. If that stops being true, this has to stop
 * printing bodies.
 */
const BODY_LIMIT = 4000;

export function installPrivyRequestLog() {
  if (!__DEV__) return;

  const original = globalThis.fetch;
  if ((original as { __privyLogged?: boolean }).__privyLogged) return;

  const patched: typeof fetch = async (input, init) => {
    // The SDK calls fetch with a Request, so the method and body live on it
    // rather than on `init`. Reading only `init` reported every call as a GET
    // with no body.
    const request =
      typeof input === "object" && input !== null && "url" in input
        ? (input as Request)
        : null;
    const url =
      request?.url ?? (input instanceof URL ? input.toString() : String(input));

    if (!url.includes("privy.io")) return original(input, init);

    const method = init?.method ?? request?.method ?? "GET";
    const isPasskey = url.includes("passkey");

    if (isPasskey) {
      const body =
        typeof init?.body === "string"
          ? init.body
          : await (request
              ?.clone()
              .text()
              .catch(() => "<unreadable>") ?? Promise.resolve("<no body>"));
      console.warn(`[privy] -> ${method} ${url}`, body.slice(0, BODY_LIMIT));
    }

    const response = await original(input, init);
    if (response.ok && !isPasskey) return response;

    // Read from a clone: a body can only be consumed once, and the caller
    // still needs it.
    const body = await response
      .clone()
      .text()
      .catch(() => "<unreadable>");
    console.warn(
      `[privy] <- ${method} ${url} ${response.status}`,
      body.slice(0, BODY_LIMIT)
    );
    return response;
  };

  (patched as { __privyLogged?: boolean }).__privyLogged = true;
  globalThis.fetch = patched;
}

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
 * Bodies are logged with token-like fields redacted. `register/init` is the
 * important path for XEN-29, but authenticate responses can include a Privy
 * token in the JSON body.
 */
const BODY_LIMIT = 4000;

const REQUEST_HEADERS_TO_LOG = [
  "privy-app-id",
  "privy-client",
  "privy-client-id",
  "x-native-app-identifier",
  "x-privy-native-app-identifier",
  "x-privy-client",
];

const RESPONSE_HEADERS_TO_LOG = [
  "content-length",
  "content-type",
  "cf-ray",
  "server",
  "via",
  "x-request-id",
  "x-vercel-id",
];

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
    const requestHeaders = mergeHeaders(request?.headers, init?.headers);
    const transport =
      "globalThis.fetch (React Native networking; Android uses OkHttp underneath)";

    if (isPasskey) {
      const body =
        typeof init?.body === "string"
          ? init.body
          : await (request
              ?.clone()
              .text()
              .catch(() => "<unreadable>") ?? Promise.resolve("<no body>"));
      console.warn(`[privy] -> ${method} ${url}`, {
        transport,
        headers: pickHeaders(requestHeaders, REQUEST_HEADERS_TO_LOG),
        body: redactBody(body),
      });
    }

    const response = await original(input, init);
    if (response.ok && !isPasskey) return response;

    // Read from a clone: a body can only be consumed once, and the caller
    // still needs it.
    const body = await response
      .clone()
      .text()
      .catch(() => "<unreadable>");
    console.warn(`[privy] <- ${method} ${url} ${response.status}`, {
      ok: response.ok,
      emptyBody: body.length === 0,
      headers: pickHeaders(
        headerRecord(response.headers),
        RESPONSE_HEADERS_TO_LOG
      ),
      body: redactBody(body),
    });
    return response;
  };

  (patched as { __privyLogged?: boolean }).__privyLogged = true;
  globalThis.fetch = patched;
}

function mergeHeaders(
  requestHeaders: Headers | undefined,
  initHeaders: HeadersInit | undefined
) {
  return {
    ...headerRecord(requestHeaders),
    ...headerRecord(initHeaders),
  };
}

function headerRecord(headers: Headers | HeadersInit | undefined) {
  const out: Record<string, string> = {};
  if (!headers) return out;

  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
    return out;
  }

  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      out[String(key).toLowerCase()] = String(value);
    }
    return out;
  }

  for (const [key, value] of Object.entries(headers)) {
    out[key.toLowerCase()] = String(value);
  }
  return out;
}

function pickHeaders(headers: Record<string, string>, names: string[]) {
  const picked: Record<string, string> = {};
  for (const name of names) {
    const value = headers[name];
    if (value) picked[name] = redactHeader(name, value);
  }
  return picked;
}

function redactHeader(name: string, value: string) {
  if (/authorization|cookie|token|secret/i.test(name)) return "<redacted>";
  return value;
}

function redactBody(body: string) {
  if (body.length === 0) return "<empty>";

  try {
    return JSON.stringify(redactJson(JSON.parse(body))).slice(0, BODY_LIMIT);
  } catch {
    return body.slice(0, BODY_LIMIT);
  }
}

function redactJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactJson);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      /authorization|token|secret/i.test(key) ? "<redacted>" : redactJson(item),
    ])
  );
}

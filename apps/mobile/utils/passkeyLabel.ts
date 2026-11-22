/**
 * Names new passkeys after the account they open.
 *
 * Privy names every passkey after the Privy app, so a phone or Mac holding
 * passkeys for several accounts shows a list of identical entries and nothing
 * to pick between them. The name is not part of anything the passkey signs, so
 * the registration options Privy returns can be renamed on the way to the
 * system prompt without weakening the credential.
 */

const REGISTRATION_OPTION_PATHS = [
  "/api/v1/passkeys/register/init",
  "/api/v1/passkeys/link/init",
];

let label: string | null = null;

/**
 * Enough of an address to tell accounts apart without spelling it out to
 * anyone looking over a shoulder: gifted123@gmail.com becomes g•••23@gmail.com.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const tail = local.length > 4 ? local.slice(-2) : "";
  return `${local[0]}•••${tail}${domain}`;
}

/** The account the next passkey created on this device belongs to. */
export function labelNextPasskey(email: string | null | undefined): void {
  label = email ? maskEmail(email.trim().toLowerCase()) : null;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

type RegistrationOptions = {
  options?: { user?: { name?: string; display_name?: string } };
};

/**
 * Must run before the Privy client is created: it keeps the `fetch` it finds
 * at construction and never looks again.
 */
export function installPasskeyLabels(target: typeof globalThis): void {
  const original = target.fetch;
  target.fetch = async (input, init) => {
    const response = await original(input, init);
    const url = urlOf(input);
    if (
      !label ||
      !response.ok ||
      !REGISTRATION_OPTION_PATHS.some((path) => url.endsWith(path))
    ) {
      return response;
    }
    let body: RegistrationOptions;
    try {
      body = (await response.clone().json()) as RegistrationOptions;
    } catch {
      return response;
    }
    const user = body.options?.user;
    if (!user) return response;
    user.name = label;
    user.display_name = label;
    return new Response(JSON.stringify(body), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

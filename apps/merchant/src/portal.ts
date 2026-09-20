import { PortalRequestError } from "./PortalRequestError";

const MISSING_TOKEN =
  "Your Merchant identity token is unavailable. Refresh this page. If this continues, enable ‘Return user data in an identity token’ in the Merchant Privy app’s Authentication settings.";

/**
 * A thin fetch boundary for the portal, bound to the owner's identity token.
 * Every call goes to the same-origin `/merchant-portal` surface and carries
 * the bearer token; a non-2xx response becomes a PortalRequestError so callers
 * can surface field-level validation the same way everywhere.
 */
export interface PortalClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
}

export function createPortalClient(token: string | null): PortalClient {
  async function send<T>(
    path: string,
    method: "GET" | "POST",
    body?: unknown,
  ): Promise<T> {
    if (!token) throw new Error(MISSING_TOKEN);
    const response = await fetch(`/merchant-portal/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    });
    const result: unknown = await response.json().catch(() => ({}));
    if (!response.ok) throw new PortalRequestError(result);
    return result as T;
  }
  return {
    get: (path) => send(path, "GET"),
    post: (path, body) => send(path, "POST", body),
  };
}

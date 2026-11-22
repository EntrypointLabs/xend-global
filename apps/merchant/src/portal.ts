import { PortalRequestError } from "./PortalRequestError";

const MISSING_TOKEN =
  "Your Merchant identity token is unavailable. Refresh this page. If this continues, enable ‘Return user data in an identity token’ in the Merchant Privy app’s Authentication settings.";

/**
 * Where the portal reaches the backend. Empty (the default) means same-origin,
 * which is how the app is served in production and how the dev proxy forwards
 * `/merchant-portal`. Set VITE_API_BASE to an absolute API origin only when the
 * portal is deployed on a different origin than the API, in which case that
 * origin must also be on the backend's CORS allowlist.
 */
const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");

export function apiUrl(path: string): string {
  return `${API_BASE}/${path.replace(/^\/+/, "")}`;
}

/**
 * A thin fetch boundary for the portal, bound to the owner's identity token.
 * Every call goes to the same-origin `/merchant-portal` surface and carries
 * the bearer token; a non-2xx response becomes a PortalRequestError so callers
 * can surface field-level validation the same way everywhere.
 */
export interface PortalClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
}

export function createPortalClient(token: string | null): PortalClient {
  async function send<T>(
    path: string,
    method: "GET" | "POST" | "PUT" | "DELETE",
    body?: unknown,
  ): Promise<T> {
    if (!token) throw new Error(MISSING_TOKEN);
    const hasBody = method === "POST" || method === "PUT";
    const response = await fetch(apiUrl(`merchant-portal/${path}`), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
      },
      body: hasBody ? JSON.stringify(body ?? {}) : undefined,
    });
    const result: unknown = await response.json().catch(() => ({}));
    if (!response.ok) throw new PortalRequestError(result, response.status);
    return result as T;
  }
  return {
    get: (path) => send(path, "GET"),
    post: (path, body) => send(path, "POST", body),
    put: (path, body) => send(path, "PUT", body),
    delete: (path) => send(path, "DELETE"),
  };
}

import { useCallback, useSyncExternalStore } from "react";

/**
 * A dependency-free history router. The portal has a handful of pages, so a
 * full router library would be more bundle than the job needs; this keeps the
 * URL as the single source of truth so refresh, deep links and the browser's
 * back/forward all land on the right page.
 */

// Browser back/forward fire "popstate"; programmatic navigate() fires a
// distinct "locationchange" so a guard can tell the two apart (the account
// draft guard must intercept only real history transitions, since click
// navigations are already guarded before they push).
function subscribe(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener("locationchange", callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener("locationchange", callback);
  };
}

export function usePathname(): string {
  return useSyncExternalStore(
    subscribe,
    () => window.location.pathname,
    () => "/",
  );
}

/** Push a new path without a full reload, then let subscribers re-read it. */
export function navigate(to: string): void {
  if (to === window.location.pathname + window.location.search) return;
  window.history.pushState(null, "", to);
  window.dispatchEvent(new Event("locationchange"));
}

export function useNavigate() {
  return useCallback((to: string) => navigate(to), []);
}

export type WorkspacePage =
  | "overview"
  | "payments"
  | "payment"
  | "developers"
  | "webhooks"
  | "account"
  | "audit";

export interface Route {
  page: WorkspacePage;
  /** For the payment-detail route, the intent reference in the path. */
  paymentId?: string;
}

const PAGE_PATHS: Record<Exclude<WorkspacePage, "payment">, string> = {
  overview: "/",
  payments: "/payments",
  developers: "/developers",
  webhooks: "/webhooks",
  account: "/account",
  audit: "/audit",
};

export function pagePath(page: Exclude<WorkspacePage, "payment">): string {
  return PAGE_PATHS[page];
}

export function paymentPath(id: string): string {
  return `/payments/${encodeURIComponent(id)}`;
}

/** Strip trailing slashes so `/account/` and `/account` resolve and compare
 * identically. Anyone comparing a raw `window.location.pathname` to a canonical
 * page path must normalize first, or a trailing slash silently misses. */
export function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

/** Resolve a pathname to a page. An unknown path falls back to the overview. */
export function routeFor(pathname: string): Route {
  const path = normalizePath(pathname);
  if (path === "/") return { page: "overview" };
  const paymentDetail = path.match(/^\/payments\/(.+)$/);
  if (paymentDetail?.[1]) {
    // Pathnames are user-controlled; a malformed escape like /payments/%
    // makes decodeURIComponent throw. Fall back to the payments list rather
    // than letting the render crash the whole portal.
    try {
      return {
        page: "payment",
        paymentId: decodeURIComponent(paymentDetail[1]),
      };
    } catch {
      return { page: "payments" };
    }
  }
  if (path === "/payments") return { page: "payments" };
  if (path === "/developers") return { page: "developers" };
  if (path === "/webhooks") return { page: "webhooks" };
  if (path === "/account") return { page: "account" };
  if (path === "/audit") return { page: "audit" };
  return { page: "overview" };
}

export function useRoute(): Route {
  const pathname = usePathname();
  return routeFor(pathname);
}

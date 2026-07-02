import { Buffer } from "buffer";

/**
 * True when the backend JWT is expired (or within `skewSeconds` of it), or when
 * it can't be parsed / carries no `exp`. This is a payload-only decode used to
 * decide whether the client should refresh before making authenticated calls;
 * the backend stays the source of truth for actually verifying the token.
 */
export function isJwtExpired(token: string, skewSeconds = 30): boolean {
  try {
    const payload = token.split(".")[1];
    if (!payload) return true;
    const json = JSON.parse(
      Buffer.from(
        payload.replace(/-/g, "+").replace(/_/g, "/"),
        "base64"
      ).toString("utf-8")
    ) as { exp?: number };
    if (typeof json.exp !== "number") return true;
    return Date.now() >= (json.exp - skewSeconds) * 1000;
  } catch {
    return true;
  }
}

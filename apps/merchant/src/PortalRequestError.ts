/** Preserve server validation details without treating arbitrary payloads as fields. */
export class PortalRequestError extends Error {
  readonly fieldErrors: Record<string, string> = {};
  /** The backend's machine-readable error code, when it sent one. */
  readonly code: string | null;
  readonly status: number | null;

  constructor(payload: unknown, status: number | null = null) {
    const data =
      payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : {};
    super(
      typeof data.message === "string"
        ? data.message
        : "We could not complete that request.",
    );
    this.status = status;
    this.code = typeof data.code === "string" ? data.code : null;
    if (!Array.isArray(data.details)) return;
    for (const detail of data.details) {
      if (!detail || typeof detail !== "object") continue;
      const { path, message } = detail as Record<string, unknown>;
      if (
        !Array.isArray(path) ||
        !path.every((part) => typeof part === "string") ||
        typeof message !== "string"
      )
        continue;
      const field = path.join(".");
      if (!Object.hasOwn(this.fieldErrors, field))
        this.fieldErrors[field] = message;
    }
  }
}

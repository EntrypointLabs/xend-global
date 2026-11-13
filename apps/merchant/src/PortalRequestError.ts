/** Preserve server validation details without treating arbitrary payloads as fields. */
export class PortalRequestError extends Error {
  readonly fieldErrors: Record<string, string> = {};

  constructor(payload: unknown) {
    const data =
      payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : {};
    super(
      typeof data.message === "string"
        ? data.message
        : "We could not complete that request.",
    );
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

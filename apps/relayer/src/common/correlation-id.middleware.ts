import { Logger } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { correlationStorage } from "./correlation-id.storage";

const HEADER = "x-correlation-id";
const VALID_ID = /^[A-Za-z0-9_-]{8,64}$/;
const logger = new Logger("Http");

/**
 * The relayer REQUIRES X-Correlation-Id on every request and rejects when
 * it is absent or malformed. This is the deliberate divergence from the
 * Phase 1 backend middleware (which MINTS a cuid2 when the header is
 * missing): per the ADR 0012 correlation contract, the relayer's only
 * legitimate caller (the Identity and Capability API) always sets the
 * header, so a request without one is not from the trusted caller and the
 * relayer mints nothing of its own. The id is echoed on the response, put
 * in every log line, and carried through AsyncLocalStorage for the request.
 */
export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const inbound = req.header(HEADER);
  if (!inbound || !VALID_ID.test(inbound)) {
    res.status(400).json({ code: "MISSING_CORRELATION_ID" });
    return;
  }
  const id = inbound;
  res.setHeader("X-Correlation-Id", id);
  const startedAt = Date.now();
  res.on("finish", () => {
    logger.log(
      `http.request correlation_id=${id} method=${req.method} path=${req.originalUrl} status=${res.statusCode} duration_ms=${Date.now() - startedAt}`,
    );
  });
  correlationStorage.run(id, () => next());
}

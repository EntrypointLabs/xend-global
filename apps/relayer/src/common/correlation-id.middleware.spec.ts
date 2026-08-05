import type { NextFunction, Request, Response } from "express";
import { correlationIdMiddleware } from "./correlation-id.middleware";
import { getCorrelationId } from "./correlation-id.storage";

function makeReq(headerValue?: string): Request {
  return {
    method: "POST",
    originalUrl: "/internal/cosign",
    header: (name: string) =>
      name.toLowerCase() === "x-correlation-id" ? headerValue : undefined,
  } as unknown as Request;
}

function makeRes(): Response & {
  statusCode: number;
  body?: unknown;
  headers: Record<string, string>;
} {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    on() {
      return this;
    },
  };
  return res as unknown as Response & {
    statusCode: number;
    body?: unknown;
    headers: Record<string, string>;
  };
}

describe("correlationIdMiddleware", () => {
  it("rejects a missing header with 400 MISSING_CORRELATION_ID and does not call next", () => {
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;
    correlationIdMiddleware(makeReq(undefined), res, next);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ code: "MISSING_CORRELATION_ID" });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a malformed header (too short) with 400", () => {
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;
    correlationIdMiddleware(makeReq("short"), res, next);
    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("echoes a valid header, exposes it via getCorrelationId inside next, and never mints its own", () => {
    const res = makeRes();
    const valid = "pi_abcDEF12_correlation";
    let seenInsideNext: string | undefined;
    const next: NextFunction = () => {
      seenInsideNext = getCorrelationId();
    };
    correlationIdMiddleware(makeReq(valid), res, next);
    expect(res.headers["X-Correlation-Id"]).toBe(valid);
    expect(seenInsideNext).toBe(valid);
  });
});

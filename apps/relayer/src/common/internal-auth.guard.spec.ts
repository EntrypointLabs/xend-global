import { HttpException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { InternalAuthGuard } from "./internal-auth.guard";

const SECRET = "super-secret-internal-auth-value";

function makeConfig(): ConfigService {
  return {
    getOrThrow: (key: string) => {
      if (key === "RELAYER_INTERNAL_AUTH_SECRET") return SECRET;
      throw new Error(`unexpected key ${key}`);
    },
  } as unknown as ConfigService;
}

function makeContext(authHeader?: string): ExecutionContext {
  const req = {
    header: (name: string) =>
      name.toLowerCase() === "x-relayer-auth" ? authHeader : undefined,
  } as unknown as Request;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe("InternalAuthGuard", () => {
  const guard = new InternalAuthGuard(makeConfig());

  it("admits a request carrying the correct secret", () => {
    expect(guard.canActivate(makeContext(SECRET))).toBe(true);
  });

  it("rejects a missing secret with 401 INVALID_RELAYER_AUTH", () => {
    try {
      guard.canActivate(makeContext(undefined));
      fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      const http = err as HttpException;
      expect(http.getStatus()).toBe(401);
      expect((http.getResponse() as { code: string }).code).toBe(
        "INVALID_RELAYER_AUTH",
      );
    }
  });

  it("rejects a wrong secret with 401", () => {
    try {
      guard.canActivate(makeContext("wrong-secret"));
      fail("expected throw");
    } catch (err) {
      expect((err as HttpException).getStatus()).toBe(401);
    }
  });
});

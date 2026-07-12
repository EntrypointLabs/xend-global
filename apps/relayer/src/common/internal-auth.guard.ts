import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "node:crypto";
import type { Request } from "express";

const HEADER = "x-relayer-auth";

/**
 * App-level half of "never publicly reachable": every route is guarded by
 * this internal-auth check. The network-level half (private networking, no
 * public ingress) is a deployment requirement recorded in the README and
 * the human checkpoint. The secret is compared in constant time so a
 * timing side channel cannot leak it.
 */
@Injectable()
export class InternalAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const provided = req.header(HEADER);
    const expected = this.config.getOrThrow<string>(
      "RELAYER_INTERNAL_AUTH_SECRET",
    );
    if (!provided || !this.constantTimeEquals(provided, expected)) {
      throw new HttpException(
        {
          code: "INVALID_RELAYER_AUTH",
          message: "missing or invalid relayer internal-auth secret",
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
    return true;
  }

  private constantTimeEquals(a: string, b: string): boolean {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
  }
}

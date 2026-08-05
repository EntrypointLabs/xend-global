import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import { InternalAuthGuard } from "../common/internal-auth.guard";
import {
  FEE_PAYER_SIGNER,
  type FeePayerSigner,
} from "../signer/signer.interface";

/**
 * Health endpoint. Guarded like every other route: the relayer exposes
 * nothing unauthenticated, so the compose healthcheck authenticates instead
 * (it sends X-Correlation-Id and X-Relayer-Auth). Returns the fee-payer
 * address so operators can confirm which key the deployment loaded.
 */
@Controller("health")
@UseGuards(InternalAuthGuard)
export class HealthController {
  constructor(
    @Inject(FEE_PAYER_SIGNER) private readonly signer: FeePayerSigner,
  ) {}

  @Get()
  check(): { status: "ok"; feePayer: string } {
    return { status: "ok", feePayer: this.signer.address };
  }
}

import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  UseGuards,
} from "@nestjs/common";
import { InternalAuthGuard } from "../common/internal-auth.guard";
import { getCorrelationId } from "../common/correlation-id.storage";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { PriorityFeeService } from "../fees/priority-fee.service";
import { CosignService } from "./cosign.service";
import {
  AddressLookupTableForbiddenError,
  BroadcastFailedError,
  CapExceededError,
  FeeCeilingExceededError,
  FeePayerWritableError,
  InstructionNotAllowedError,
  InvalidSignerCountError,
  MessageMismatchError,
  MissingSignatureError,
  SimulationFailedError,
  UnsupportedMintError,
  WrongDecimalsError,
  WrongDestinationError,
  WrongFeePayerError,
} from "./cosign.errors";
import {
  CosignRequestSchema,
  type CosignRequest,
  type CosignResponse,
} from "./dtos";

/**
 * Internal-only co-sign channel. Every route is guarded by InternalAuthGuard
 * (the relayer is never public), reads the required correlation id from the
 * request-scoped store, and maps typed errors to { code, message } + status
 * (mirrors transfer.controller.ts:95).
 */
@Controller("internal")
@UseGuards(InternalAuthGuard)
export class CosignController {
  constructor(
    private readonly cosign: CosignService,
    private readonly fees: PriorityFeeService,
  ) {}

  @Post("cosign")
  async doCosign(
    @Body(new ZodValidationPipe(CosignRequestSchema)) body: CosignRequest,
  ): Promise<CosignResponse> {
    const correlationId = getCorrelationId() ?? "";
    try {
      return await this.cosign.cosign(body, correlationId);
    } catch (err) {
      this.mapCosignError(err);
    }
  }

  @Get("priority-fee")
  async priorityFee(): Promise<{ computeUnitPrice: string }> {
    const { computeUnitPrice } = await this.fees.estimate();
    // Wire contract (CONTRACTS.md): computeUnitPrice is a decimal string.
    return { computeUnitPrice: computeUnitPrice.toString() };
  }

  private mapCosignError(err: unknown): never {
    // 403: security-policy refusals (drain vectors).
    if (
      err instanceof InstructionNotAllowedError ||
      err instanceof AddressLookupTableForbiddenError ||
      err instanceof FeePayerWritableError ||
      err instanceof WrongFeePayerError
    ) {
      throw new HttpException(
        { code: (err as { code: string }).code, message: err.message },
        HttpStatus.FORBIDDEN,
      );
    }
    // 422: unprocessable content / shape mismatches.
    if (
      err instanceof UnsupportedMintError ||
      err instanceof WrongDestinationError ||
      err instanceof WrongDecimalsError ||
      err instanceof FeeCeilingExceededError ||
      err instanceof MessageMismatchError ||
      err instanceof MissingSignatureError ||
      err instanceof InvalidSignerCountError
    ) {
      throw new HttpException(
        { code: (err as { code: string }).code, message: err.message },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    // 429: caps.
    if (err instanceof CapExceededError) {
      throw new HttpException(
        { code: err.code, message: err.message },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    // 502: simulation / broadcast / RPC.
    if (
      err instanceof SimulationFailedError ||
      err instanceof BroadcastFailedError
    ) {
      throw new HttpException(
        { code: err.code, message: err.message },
        HttpStatus.BAD_GATEWAY,
      );
    }
    throw err as Error;
  }
}

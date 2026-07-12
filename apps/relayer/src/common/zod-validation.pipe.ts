import { BadRequestException, PipeTransform } from "@nestjs/common";
import { ZodSchema, ZodError } from "zod";

/**
 * Minimal Nest pipe that runs schema.parse against the incoming body so the
 * service layer never sees a malformed payload. Mirrors the backend pipe
 * (apps/backend/src/common/zod-validation.pipe.ts); the relayer keeps its
 * own copy because it shares no code with apps/backend by design.
 */
export class ZodValidationPipe<T = unknown> implements PipeTransform<
  unknown,
  T
> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    try {
      return this.schema.parse(value);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException({
          statusCode: 400,
          message: "Validation failed",
          details: err.issues,
        });
      }
      throw err;
    }
  }
}

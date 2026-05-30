import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodSchema, ZodError } from 'zod';

/**
 * ZodValidationPipe — minimal Nest pipe that runs `schema.parse(value)`
 * against the incoming body / param / query value. Per the Phase 1
 * plan ("Every endpoint validates request body with Zod"), every new
 * controller method binds one of these to its request DTO so the
 * service layer never sees a malformed payload.
 *
 * On failure we throw `BadRequestException` with the Zod issue list
 * surfaced under `details`, which Nest renders as a 400 JSON response.
 * The intentional contract is:
 *   { statusCode: 400, message: 'Validation failed', details: ZodIssue[] }
 *
 * We deliberately do NOT translate Zod issues into a custom error code
 * here — the Phase 1 error-code table covers domain-level failures
 * (INVALID_PRIVY_TOKEN, INVALID_RECIPIENT, etc.); raw schema-shape
 * failures are best surfaced as their underlying validation reason.
 *
 * Usage:
 *   @Post('exchange')
 *   exchange(
 *     @Body(new ZodValidationPipe(ExchangeRequestSchema))
 *     dto: ExchangeRequest,
 *   ) { ... }
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
          message: 'Validation failed',
          details: err.issues,
        });
      }
      throw err;
    }
  }
}

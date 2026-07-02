import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodSchema, ZodError } from 'zod';

/**
 * Minimal Nest pipe that runs `schema.parse(value)` against the incoming
 * body / param / query value so the service layer never sees a malformed
 * payload.
 *
 * On failure it throws `BadRequestException` with the Zod issue list
 * under `details`, which Nest renders as a 400 JSON response:
 *   { statusCode: 400, message: 'Validation failed', details: ZodIssue[] }
 *
 * Zod issues are intentionally NOT translated into a custom domain error
 * code — raw schema-shape failures are best surfaced as their underlying
 * validation reason.
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

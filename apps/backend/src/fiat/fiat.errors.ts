import { HttpException } from '@nestjs/common';

export class FiatError extends HttpException {
  constructor(code: string, message: string, status = 422) {
    super({ code, message }, status);
  }
}

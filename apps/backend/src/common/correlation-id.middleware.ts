import { Logger } from '@nestjs/common';
import { createId } from '@paralleldrive/cuid2';
import type { NextFunction, Request, Response } from 'express';
import { correlationStorage } from './correlation-id.storage';

const HEADER = 'x-correlation-id';
const VALID_ID = /^[A-Za-z0-9_-]{8,64}$/;
const logger = new Logger('Http');

export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const inbound = req.header(HEADER);
  const id = inbound && VALID_ID.test(inbound) ? inbound : createId();
  res.setHeader('X-Correlation-Id', id);
  const startedAt = Date.now();
  res.on('finish', () => {
    logger.log(
      `http.request correlation_id=${id} method=${req.method} path=${req.originalUrl} status=${res.statusCode} duration_ms=${Date.now() - startedAt}`,
    );
  });
  correlationStorage.run(id, next);
}

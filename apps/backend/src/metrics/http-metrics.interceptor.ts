import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { httpRequestDuration } from './metrics';

type RoutedRequest = Request & { route?: { path?: string } };

/**
 * The label is the route template, never the concrete URL, so an id in the
 * path cannot fan the series out.
 */
export function routeLabel(req: RoutedRequest): string {
  // Express types `route` as `any`, so read the template through a narrow
  // shape rather than trusting the property.
  const route = (req as { route?: { path?: unknown } }).route;
  const template = typeof route?.path === 'string' ? route.path : undefined;
  if (!template) return 'unmatched';
  return `${req.baseUrl ?? ''}${template}`;
}

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<RoutedRequest>();
    const res = http.getResponse<Response>();
    const method = req.method;
    const route = routeLabel(req);
    const stop = httpRequestDuration.startTimer();
    let recorded = false;
    const record = (status: number) => {
      if (recorded) return;
      recorded = true;
      stop({ method, route, status: String(status) });
    };
    return next.handle().pipe(
      tap({
        next: () => record(res.statusCode),
        complete: () => record(res.statusCode),
        error: (err: unknown) =>
          record(err instanceof HttpException ? err.getStatus() : 500),
      }),
    );
  }
}

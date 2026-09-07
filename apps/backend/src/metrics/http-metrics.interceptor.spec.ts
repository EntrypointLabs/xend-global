import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { HttpMetricsInterceptor, routeLabel } from './http-metrics.interceptor';
import { httpRequestDuration, metricsRegistry } from './metrics';

function makeContext(req: Record<string, unknown>, statusCode = 200) {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({ statusCode }),
    }),
  } as unknown as ExecutionContext;
}

async function countFor(labels: Record<string, string>): Promise<number> {
  const metric = await httpRequestDuration.get();
  const sample = metric.values.find(
    (v) =>
      v.metricName === 'xend_http_request_duration_seconds_count' &&
      Object.entries(labels).every(([k, val]) => v.labels[k] === val),
  );
  return sample?.value ?? 0;
}

describe('HttpMetricsInterceptor', () => {
  beforeEach(() => httpRequestDuration.reset());

  it('records one observation under the route template and response status', async () => {
    const interceptor = new HttpMetricsInterceptor();
    const ctx = makeContext({
      method: 'GET',
      baseUrl: '',
      route: { path: '/v1/payment_intents/:id' },
    });
    const next: CallHandler = { handle: () => of({ id: 'pi_1' }) };

    await lastValueFrom(interceptor.intercept(ctx, next));

    expect(
      await countFor({
        method: 'GET',
        route: '/v1/payment_intents/:id',
        status: '200',
      }),
    ).toBe(1);
  });

  it('records the HttpException status when the handler throws', async () => {
    const interceptor = new HttpMetricsInterceptor();
    const ctx = makeContext({
      method: 'POST',
      route: { path: '/checkout/authorize' },
    });
    const next: CallHandler = {
      handle: () =>
        throwError(() => new HttpException({ code: 'GONE' }, HttpStatus.GONE)),
    };

    await expect(
      lastValueFrom(interceptor.intercept(ctx, next)),
    ).rejects.toBeInstanceOf(HttpException);

    expect(
      await countFor({
        method: 'POST',
        route: '/checkout/authorize',
        status: '410',
      }),
    ).toBe(1);
  });

  it('labels a request that matched no route as unmatched', () => {
    expect(routeLabel({ method: 'GET' } as never)).toBe('unmatched');
  });

  it('is registered on the shared registry', () => {
    expect(
      metricsRegistry.getSingleMetric('xend_http_request_duration_seconds'),
    ).toBe(httpRequestDuration);
  });
});

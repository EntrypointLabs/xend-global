// Explicit rather than transitive: @peculiar/x509 loads tsyringe, which needs
// the polyfill present before its module body runs.
import 'reflect-metadata';

// Tracing patches http, express, pg, ioredis and kafkajs when they are first
// required, so it has to start before anything below pulls them in.
import { startTracing } from './tracing/otel';
startTracing();

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { correlationIdMiddleware } from './common/correlation-id.middleware';
import { noStoreMiddleware } from './common/no-store.middleware';

const BODY_LIMIT = '1mb';

async function bootstrap() {
  // rawBody:true gives the webhook receivers access to the raw request bytes
  // for HMAC verification. Providers sign the unmodified payload; any JSON
  // re-serialization would change the byte sequence and break verification.
  // bodyParser:false so the parsers below are registered with a size limit.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bodyParser: false,
  });
  app.useBodyParser('json', { limit: BODY_LIMIT });
  app.useBodyParser('urlencoded', { extended: true, limit: BODY_LIMIT });
  const config = app.get(ConfigService);
  app.set('trust proxy', config.get<boolean | number>('TRUST_PROXY') ?? false);
  // Register the correlation-ID middleware BEFORE CORS so every response,
  // including preflights and rejections, carries X-Correlation-Id.
  app.use(correlationIdMiddleware);
  // Off, not weakened. An ETag is what lets a client revalidate and be handed a
  // 304, and a 304 on a per-Consumer response is either an error the client
  // cannot read or another Consumer's cached body.
  app.set('etag', false);
  app.use(noStoreMiddleware);
  const allowedOrigins = config
    .getOrThrow<string>('CORS_ALLOWED_ORIGINS')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  // The intent summary is read by the checkout sheet running on the merchant's
  // own page, and a merchant origin is not knowable ahead of time. The route
  // carries no credentials and its capability is the reference itself, which
  // the merchant already holds, so it answers any origin. Everything else stays
  // on the allowlist and keeps sending cookies.
  type CorsRequest = { method?: string; url?: string };
  const isPublicSummary = (req: CorsRequest): boolean =>
    req.method === 'GET' && /^\/checkout\/intents\/[^/]+/.test(req.url ?? '');
  app.enableCors((req: CorsRequest, callback) => {
    callback(
      null,
      isPublicSummary(req)
        ? {
            origin: true,
            credentials: false,
            exposedHeaders: ['X-Correlation-Id'],
          }
        : {
            origin: allowedOrigins,
            credentials: true,
            exposedHeaders: ['X-Correlation-Id'],
          },
    );
  });
  app.enableShutdownHooks();
  const port = config.get<number>('PORT') ?? 3000;
  await app.listen(port);
  console.log(`Backend is running on port ${port}`);
}
void bootstrap();

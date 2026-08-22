// Explicit rather than transitive: @peculiar/x509 loads tsyringe, which needs
// the polyfill present before its module body runs.
import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { correlationIdMiddleware } from './common/correlation-id.middleware';
import { noStoreMiddleware } from './common/no-store.middleware';

async function bootstrap() {
  // rawBody:true gives the WebhookController access to the raw request
  // bytes for HMAC verification. Helius signs the unmodified payload;
  // any JSON re-serialization would change the byte sequence and
  // break verification.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  // Register the correlation-ID middleware BEFORE CORS so every response,
  // including preflights and rejections, carries X-Correlation-Id.
  app.use(correlationIdMiddleware);
  // Off, not weakened. An ETag is what lets a client revalidate and be handed a
  // 304, and a 304 on a per-Consumer response is either an error the client
  // cannot read or another Consumer's cached body.
  app.set('etag', false);
  app.use(noStoreMiddleware);
  const config = app.get(ConfigService);
  const allowedOrigins = config
    .getOrThrow<string>('CORS_ALLOWED_ORIGINS')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    exposedHeaders: ['X-Correlation-Id'],
  });
  await app.listen(process.env.PORT ?? 3000);
  console.log(`Backend is running on port ${process.env.PORT}`);
}
void bootstrap();

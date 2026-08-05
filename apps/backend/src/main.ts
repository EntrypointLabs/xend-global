import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { correlationIdMiddleware } from './common/correlation-id.middleware';

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

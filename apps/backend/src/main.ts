import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody:true gives the WebhookController access to the raw request
  // bytes for HMAC verification. Helius signs the unmodified payload;
  // any JSON re-serialization would change the byte sequence and
  // break verification.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  app.enableCors();
  await app.listen(process.env.PORT ?? 3000);
  console.log(`Backend is running on port ${process.env.PORT}`);
}
void bootstrap();

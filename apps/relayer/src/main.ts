import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { correlationIdMiddleware } from "./common/correlation-id.middleware";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Correlation middleware runs FIRST so every response (including the 400
  // it emits for a missing header) carries the contract. The relayer serves
  // no browser, so app.enableCors() is deliberately NOT called: CORS is
  // meaningless here and would only widen the surface.
  app.use(correlationIdMiddleware);
  await app.listen(process.env.PORT ?? 8787);
}
void bootstrap();

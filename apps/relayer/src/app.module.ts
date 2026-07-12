import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { ConfigModule } from "./config/config.module";

/**
 * Relayer composition root. ConfigModule is global (Joi-validated env).
 * ScheduleModule.forRoot() enables the @Cron balance monitor. Signer, RPC,
 * health, and the co-sign pipeline modules are registered as they land.
 */
@Module({
  imports: [ConfigModule, ScheduleModule.forRoot()],
})
export class AppModule {}

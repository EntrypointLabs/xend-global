import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { InternalAuthGuard } from "./common/internal-auth.guard";
import { ConfigModule } from "./config/config.module";
import { HealthController } from "./health/health.controller";
import { RelayerRpcModule } from "./rpc/relayer-rpc.module";
import { SignerModule } from "./signer/signer.module";

/**
 * Relayer composition root. ConfigModule is global (Joi-validated env).
 * ScheduleModule.forRoot() enables the @Cron balance monitor. SignerModule
 * provides the fee-payer seam and RELAYER_CONFIG; RelayerRpcModule the kit
 * RPC client. The co-sign pipeline modules are added in Phase 3.3.
 */
@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    SignerModule,
    RelayerRpcModule,
  ],
  controllers: [HealthController],
  providers: [InternalAuthGuard],
})
export class AppModule {}

import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { CapsModule } from "./caps/caps.module";
import { InternalAuthGuard } from "./common/internal-auth.guard";
import { ConfigModule } from "./config/config.module";
import { CosignModule } from "./cosign/cosign.module";
import { PriorityFeeModule } from "./fees/priority-fee.module";
import { HealthController } from "./health/health.controller";
import { MonitorModule } from "./monitor/monitor.module";
import { RelayerRpcModule } from "./rpc/relayer-rpc.module";
import { SignerModule } from "./signer/signer.module";

/**
 * Relayer composition root. ConfigModule is global (Joi-validated env).
 * ScheduleModule.forRoot() enables the @Cron balance monitor. SignerModule
 * provides the fee-payer seam and RELAYER_CONFIG; RelayerRpcModule the kit
 * RPC client; the co-sign pipeline (CosignModule), caps, priority fee, and
 * balance monitor complete the anti-drain surface.
 */
@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    SignerModule,
    RelayerRpcModule,
    CapsModule,
    PriorityFeeModule,
    CosignModule,
    MonitorModule,
  ],
  controllers: [HealthController],
  providers: [InternalAuthGuard],
})
export class AppModule {}

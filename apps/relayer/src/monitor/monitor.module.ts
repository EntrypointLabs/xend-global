import { Module } from "@nestjs/common";
import { CapsModule } from "../caps/caps.module";
import { RelayerRpcModule } from "../rpc/relayer-rpc.module";
import { SignerModule } from "../signer/signer.module";
import { BalanceMonitorService } from "./balance-monitor.service";

@Module({
  imports: [SignerModule, RelayerRpcModule, CapsModule],
  providers: [BalanceMonitorService],
})
export class MonitorModule {}

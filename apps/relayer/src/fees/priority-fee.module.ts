import { Module } from "@nestjs/common";
import { RelayerRpcModule } from "../rpc/relayer-rpc.module";
import { SignerModule } from "../signer/signer.module";
import { PriorityFeeService } from "./priority-fee.service";

@Module({
  imports: [SignerModule, RelayerRpcModule],
  providers: [PriorityFeeService],
  exports: [PriorityFeeService],
})
export class PriorityFeeModule {}

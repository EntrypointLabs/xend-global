import { Module } from "@nestjs/common";
import { InternalAuthGuard } from "../common/internal-auth.guard";
import { CapsModule } from "../caps/caps.module";
import { PriorityFeeModule } from "../fees/priority-fee.module";
import { RelayerRpcModule } from "../rpc/relayer-rpc.module";
import { SignerModule } from "../signer/signer.module";
import { CosignController } from "./cosign.controller";
import { CosignService } from "./cosign.service";

@Module({
  imports: [SignerModule, RelayerRpcModule, CapsModule, PriorityFeeModule],
  controllers: [CosignController],
  providers: [CosignService, InternalAuthGuard],
})
export class CosignModule {}

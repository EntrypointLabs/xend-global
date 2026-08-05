import { Module } from "@nestjs/common";
import { RelayerRpc } from "./relayer-rpc";

@Module({
  providers: [RelayerRpc],
  exports: [RelayerRpc],
})
export class RelayerRpcModule {}

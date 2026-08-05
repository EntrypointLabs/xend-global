import { Module } from "@nestjs/common";
import { SignerModule } from "../signer/signer.module";
import { CapsService } from "./caps.service";

@Module({
  imports: [SignerModule],
  providers: [CapsService],
  exports: [CapsService],
})
export class CapsModule {}

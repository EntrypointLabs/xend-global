import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { KeypairFeePayerSigner } from "./keypair.signer";

/**
 * Pilot-floor signer: loads the fee-payer key from env. The key is read
 * once at boot via config.getOrThrow and never logged.
 */
@Injectable()
export class EnvKeySigner extends KeypairFeePayerSigner {
  constructor(config: ConfigService) {
    super(config.getOrThrow<string>("RELAYER_FEE_PAYER_SECRET_KEY"), "env");
  }
}

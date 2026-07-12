import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  buildRelayerConfig,
  RELAYER_CONFIG,
  type RelayerConfig,
} from "../relayer-config";
import { EnvKeySigner } from "./env-key.signer";
import { FEE_PAYER_SIGNER, type FeePayerSigner } from "./signer.interface";

/**
 * Binds the fee-payer signer seam to the env-key adapter and assembles the
 * RELAYER_CONFIG once at boot, pinning the fee-payer address from the
 * signer. Both are exported so the co-sign pipeline (Phase 3.3) depends only
 * on the tokens, never on the concrete signer. Swapping to a Turnkey / KMS
 * signer is a single change here.
 */
@Module({
  providers: [
    EnvKeySigner,
    { provide: FEE_PAYER_SIGNER, useExisting: EnvKeySigner },
    {
      provide: RELAYER_CONFIG,
      useFactory: (
        config: ConfigService,
        signer: FeePayerSigner,
      ): RelayerConfig => buildRelayerConfig(config, signer.address),
      inject: [ConfigService, FEE_PAYER_SIGNER],
    },
  ],
  exports: [FEE_PAYER_SIGNER, RELAYER_CONFIG],
})
export class SignerModule {}

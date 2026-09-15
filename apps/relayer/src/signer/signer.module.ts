import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  buildRelayerConfig,
  RELAYER_CONFIG,
  type RelayerConfig,
} from "../relayer-config";
import { EnvKeySigner } from "./env-key.signer";
import { KmsKeySigner } from "./kms-key.signer";
import { AwsKmsClient, KMS_CLIENT, type KmsClient } from "./kms.client";
import { FEE_PAYER_SIGNER, type FeePayerSigner } from "./signer.interface";

export function selectFeePayerSigner(
  config: ConfigService,
  kms: KmsClient,
): Promise<FeePayerSigner> {
  const provider = config.get<string>("RELAYER_FEE_PAYER_PROVIDER") ?? "env";
  switch (provider) {
    case "env":
      return Promise.resolve(new EnvKeySigner(config));
    case "aws-kms":
      return KmsKeySigner.create(config, kms);
    default:
      throw new Error(`unknown RELAYER_FEE_PAYER_PROVIDER: ${provider}`);
  }
}

/**
 * Binds the fee-payer signer seam to the adapter RELAYER_FEE_PAYER_PROVIDER
 * names and assembles the RELAYER_CONFIG once at boot, pinning the fee-payer
 * address from the signer. Both are exported so the co-sign pipeline depends
 * only on the tokens, never on the concrete signer.
 */
@Module({
  providers: [
    { provide: KMS_CLIENT, useClass: AwsKmsClient },
    {
      provide: FEE_PAYER_SIGNER,
      inject: [ConfigService, KMS_CLIENT],
      useFactory: selectFeePayerSigner,
    },
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

import type { ConfigService } from "@nestjs/config";
import { KeypairFeePayerSigner } from "./keypair.signer";
import type { KmsClient } from "./kms.client";

/**
 * KMS-envelope signer. The environment carries only the fee-payer secret
 * encrypted under a KMS key (RELAYER_FEE_PAYER_SECRET_KEY_CIPHERTEXT, made
 * with apps/backend/scripts/kms-encrypt-secret.ts); one Decrypt at boot
 * turns it back into the keypair. The decrypt is async, so this is built by
 * an async factory rather than a constructor.
 */
export class KmsKeySigner extends KeypairFeePayerSigner {
  static async create(
    config: ConfigService,
    kms: KmsClient,
  ): Promise<KmsKeySigner> {
    const ciphertext = config.getOrThrow<string>(
      "RELAYER_FEE_PAYER_SECRET_KEY_CIPHERTEXT",
    );
    const plaintext = await kms.decrypt(Buffer.from(ciphertext, "base64"));
    const secretBase58 = Buffer.from(plaintext).toString("utf-8").trim();
    return new KmsKeySigner(secretBase58);
  }

  private constructor(secretBase58: string) {
    super(secretBase58, "aws-kms");
  }
}

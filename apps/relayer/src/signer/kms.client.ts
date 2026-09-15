import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DecryptCommand, KMSClient } from "@aws-sdk/client-kms";

export const KMS_CLIENT = Symbol("KmsClient");

/** The one KMS call the fee payer needs: unwrap its key ciphertext at boot. */
export interface KmsClient {
  decrypt(ciphertext: Uint8Array): Promise<Uint8Array>;
}

@Injectable()
export class AwsKmsClient implements KmsClient {
  private sdk?: KMSClient;

  constructor(private readonly config: ConfigService) {}

  async decrypt(ciphertext: Uint8Array): Promise<Uint8Array> {
    const region = this.config.get<string>("AWS_KMS_REGION");
    this.sdk ??= new KMSClient(region ? { region } : {});
    const out = await this.sdk.send(
      new DecryptCommand({ CiphertextBlob: ciphertext }),
    );
    if (!out.Plaintext) {
      throw new Error("KMS Decrypt returned no plaintext");
    }
    return out.Plaintext;
  }
}

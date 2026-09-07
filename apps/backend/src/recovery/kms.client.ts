import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DecryptCommand,
  EncryptCommand,
  GenerateDataKeyCommand,
  KMSClient,
} from '@aws-sdk/client-kms';

export const KMS_CLIENT = Symbol('KMS_CLIENT');

export interface DataKey {
  plaintext: Uint8Array;
  ciphertext: Uint8Array;
}

/**
 * The three KMS calls envelope custody needs. AWS KMS cannot sign Ed25519, so
 * it never holds a Solana key directly: it wraps the key that does.
 */
export interface KmsClient {
  generateDataKey(keyId: string): Promise<DataKey>;
  decrypt(ciphertext: Uint8Array): Promise<Uint8Array>;
  encrypt(keyId: string, plaintext: Uint8Array): Promise<Uint8Array>;
}

@Injectable()
export class AwsKmsClient implements KmsClient {
  private sdk?: KMSClient;

  constructor(private readonly config: ConfigService) {}

  private get client(): KMSClient {
    const region = this.config.get<string>('AWS_KMS_REGION');
    this.sdk ??= new KMSClient(region ? { region } : {});
    return this.sdk;
  }

  async generateDataKey(keyId: string): Promise<DataKey> {
    const out = await this.client.send(
      new GenerateDataKeyCommand({ KeyId: keyId, KeySpec: 'AES_256' }),
    );
    if (!out.Plaintext || !out.CiphertextBlob) {
      throw new Error('KMS GenerateDataKey returned no key material');
    }
    return { plaintext: out.Plaintext, ciphertext: out.CiphertextBlob };
  }

  async decrypt(ciphertext: Uint8Array): Promise<Uint8Array> {
    const out = await this.client.send(
      new DecryptCommand({ CiphertextBlob: ciphertext }),
    );
    if (!out.Plaintext) {
      throw new Error('KMS Decrypt returned no plaintext');
    }
    return out.Plaintext;
  }

  async encrypt(keyId: string, plaintext: Uint8Array): Promise<Uint8Array> {
    const out = await this.client.send(
      new EncryptCommand({ KeyId: keyId, Plaintext: plaintext }),
    );
    if (!out.CiphertextBlob) {
      throw new Error('KMS Encrypt returned no ciphertext');
    }
    return out.CiphertextBlob;
  }
}

/** Decrypts a base64 KMS ciphertext into the UTF-8 secret it was made from. */
export async function decryptSecretString(
  kms: KmsClient,
  ciphertextBase64: string,
): Promise<string> {
  const plaintext = await kms.decrypt(Buffer.from(ciphertextBase64, 'base64'));
  return Buffer.from(plaintext).toString('utf-8').trim();
}

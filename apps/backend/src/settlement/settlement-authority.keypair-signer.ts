import { Logger, type OnModuleInit } from '@nestjs/common';
import {
  createKeyPairSignerFromBytes,
  getBase58Encoder,
  getBase64Encoder,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  partiallySignTransaction,
  type KeyPairSigner,
} from '@solana/kit';
import type { SolanaRpc } from '../solana/solana-rpc.interface';
import type { SettlementAuthoritySigner } from './settlement-authority.interface';

/**
 * Holds the authority's Ed25519 keypair in process memory and partial-signs
 * with it. Where the base58 secret comes from is the one thing subclasses
 * decide: the raw environment at the pilot floor, or a KMS ciphertext
 * decrypted once at boot.
 */
export abstract class SettlementAuthorityKeypairSigner
  implements SettlementAuthoritySigner, OnModuleInit
{
  protected readonly logger = new Logger(SettlementAuthorityKeypairSigner.name);
  private signer!: KeyPairSigner;

  protected constructor(
    private readonly solana: SolanaRpc,
    private readonly provider: string,
  ) {}

  protected abstract loadSecretBase58(): Promise<string>;

  async onModuleInit(): Promise<void> {
    const secretBytes = getBase58Encoder().encode(
      await this.loadSecretBase58(),
    );
    this.signer = await createKeyPairSignerFromBytes(secretBytes);
    // Log the pubkey only. NEVER log the secret key.
    this.logger.log(
      `settlement.authority.ready provider=${this.provider} address=${this.signer.address}`,
    );
  }

  get address(): string {
    return this.signer.address;
  }

  async signAndSend(wireTxBase64: string): Promise<string> {
    const bytes = getBase64Encoder().encode(wireTxBase64);
    const tx = getTransactionDecoder().decode(bytes);
    const signed = await partiallySignTransaction([this.signer.keyPair], tx);
    const signedWireBase64 = getBase64EncodedWireTransaction(signed);
    return this.solana.sendRawTransaction(signedWireBase64);
  }
}

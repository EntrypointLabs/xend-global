import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createKeyPairSignerFromBytes,
  getBase58Encoder,
  getBase64Encoder,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  partiallySignTransaction,
  type KeyPairSigner,
} from '@solana/kit';
import { SOLANA_RPC, type SolanaRpc } from '../solana/solana-rpc.interface';
import type { SettlementAuthoritySigner } from './settlement-authority.interface';

/**
 * Env-key settlement authority signer (kit 7). Loads the base58 Ed25519
 * secret from SETTLEMENT_AUTHORITY_SECRET_KEY at boot, exposes the derived
 * pubkey, and partial-signs + broadcasts wire transactions as the authority.
 * The secret key is never logged. Custody order (KMS/Turnkey > cloud-KMS >
 * raw env at pilot floor) is an ops concern documented in .env.example.
 */
@Injectable()
export class SettlementAuthorityEnvSigner
  implements SettlementAuthoritySigner, OnModuleInit
{
  private readonly logger = new Logger(SettlementAuthorityEnvSigner.name);
  private signer!: KeyPairSigner;

  constructor(
    private readonly config: ConfigService,
    @Inject(SOLANA_RPC) private readonly solana: SolanaRpc,
  ) {}

  async onModuleInit(): Promise<void> {
    const secretBase58 = this.config.getOrThrow<string>(
      'SETTLEMENT_AUTHORITY_SECRET_KEY',
    );
    const secretBytes = getBase58Encoder().encode(secretBase58);
    this.signer = await createKeyPairSignerFromBytes(secretBytes);
    // Log the pubkey only. NEVER log the secret key.
    this.logger.log(
      `settlement.authority.ready address=${this.signer.address}`,
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

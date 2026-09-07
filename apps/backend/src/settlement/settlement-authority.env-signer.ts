import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SOLANA_RPC, type SolanaRpc } from '../solana/solana-rpc.interface';
import { SettlementAuthorityKeypairSigner } from './settlement-authority.keypair-signer';

/**
 * Env-key settlement authority signer. Loads the base58 Ed25519 secret from
 * SETTLEMENT_AUTHORITY_SECRET_KEY at boot. Pilot floor of the custody order
 * (KMS/Turnkey > cloud-KMS envelope > raw env), documented in .env.example.
 */
@Injectable()
export class SettlementAuthorityEnvSigner extends SettlementAuthorityKeypairSigner {
  constructor(
    private readonly config: ConfigService,
    @Inject(SOLANA_RPC) solana: SolanaRpc,
  ) {
    super(solana, 'env');
  }

  protected loadSecretBase58(): Promise<string> {
    return Promise.resolve(
      this.config.getOrThrow<string>('SETTLEMENT_AUTHORITY_SECRET_KEY'),
    );
  }
}

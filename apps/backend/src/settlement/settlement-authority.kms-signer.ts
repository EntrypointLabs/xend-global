import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  KMS_CLIENT,
  decryptSecretString,
  type KmsClient,
} from '../recovery/kms.client';
import { SOLANA_RPC, type SolanaRpc } from '../solana/solana-rpc.interface';
import { SettlementAuthorityKeypairSigner } from './settlement-authority.keypair-signer';

/**
 * KMS-envelope settlement authority signer. The environment carries only
 * SETTLEMENT_AUTHORITY_SECRET_KEY_CIPHERTEXT, the base58 secret encrypted
 * under a KMS key (`scripts/kms-encrypt-secret.ts`), and one Decrypt at boot
 * turns it back into the keypair. Reading the environment alone no longer
 * yields the key; a KMS Decrypt grant does, and that call is audited.
 */
@Injectable()
export class SettlementAuthorityKmsSigner extends SettlementAuthorityKeypairSigner {
  constructor(
    private readonly config: ConfigService,
    @Inject(SOLANA_RPC) solana: SolanaRpc,
    @Inject(KMS_CLIENT) private readonly kms: KmsClient,
  ) {
    super(solana, 'aws-kms');
  }

  protected loadSecretBase58(): Promise<string> {
    return decryptSecretString(
      this.kms,
      this.config.getOrThrow<string>(
        'SETTLEMENT_AUTHORITY_SECRET_KEY_CIPHERTEXT',
      ),
    );
  }
}

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AwsKmsClient,
  KMS_CLIENT,
  type KmsClient,
} from '../recovery/kms.client';
import { SOLANA_RPC, type SolanaRpc } from '../solana/solana-rpc.interface';
import { SolanaModule } from '../solana/solana.module';
import { SETTLEMENT_AUTHORITY_SIGNER } from './settlement-authority.interface';
import { SettlementAuthorityEnvSigner } from './settlement-authority.env-signer';
import { SettlementAuthorityKmsSigner } from './settlement-authority.kms-signer';

/**
 * Only the selected signer is constructed. Registering both would run both
 * boot hooks, and the one not in use would fail on the secret it does not have.
 */
export function selectSettlementAuthoritySigner(
  config: ConfigService,
  solana: SolanaRpc,
  kms: KmsClient,
): SettlementAuthorityEnvSigner | SettlementAuthorityKmsSigner {
  const provider = config.get<string>('SETTLEMENT_AUTHORITY_PROVIDER') ?? 'env';
  switch (provider) {
    case 'env':
      return new SettlementAuthorityEnvSigner(config, solana);
    case 'aws-kms':
      return new SettlementAuthorityKmsSigner(config, solana, kms);
    default:
      throw new Error(`unknown SETTLEMENT_AUTHORITY_PROVIDER: ${provider}`);
  }
}

/**
 * The settlement authority, bound on its own.
 *
 * A Payment leaves the same vault a Send does, so the settlement layer has to
 * reach the Spend path, and the Spend path has to reach the authority that pays
 * its fees. Binding the signer in its own module is what keeps that from being
 * a cycle between the two.
 */
@Module({
  imports: [SolanaModule],
  providers: [
    { provide: KMS_CLIENT, useClass: AwsKmsClient },
    {
      provide: SETTLEMENT_AUTHORITY_SIGNER,
      inject: [ConfigService, SOLANA_RPC, KMS_CLIENT],
      useFactory: selectSettlementAuthoritySigner,
    },
  ],
  exports: [SETTLEMENT_AUTHORITY_SIGNER],
})
export class SettlementAuthorityModule {}

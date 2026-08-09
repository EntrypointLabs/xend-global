import { Module } from '@nestjs/common';

import { RedisModule } from '../redis/redis.module';
import { AppAttestVerifier } from './app-attest.verifier';
import { RedisAttestationNonceStore } from './attestation-nonce.redis';
import { ATTESTATION_NONCE_STORE } from './attestation.interface';
import { AttestationService } from './attestation.service';
import { KeyAttestationVerifier } from './key-attestation.verifier';

@Module({
  imports: [RedisModule],
  providers: [
    AttestationService,
    AppAttestVerifier,
    KeyAttestationVerifier,
    { provide: ATTESTATION_NONCE_STORE, useClass: RedisAttestationNonceStore },
  ],
  exports: [AttestationService],
})
export class AttestationModule {}

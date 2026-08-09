import { Inject, Injectable, Logger } from '@nestjs/common';

import { AppAttestVerifier } from './app-attest.verifier';
import { AttestationNonceError } from './attestation.errors';
import { ATTESTATION_NONCE_STORE } from './attestation.interface';
import type {
  AttestationNonceStore,
  AttestationRequest,
  VerifiedAttestation,
} from './attestation.interface';
import { KeyAttestationVerifier } from './key-attestation.verifier';

/**
 * Issues attestation nonces and verifies what comes back.
 *
 * The nonce is consumed before verification runs. Verifying first and
 * consuming after would let a client hammer a single nonce until one
 * hand-crafted attestation happened to pass, which is the opposite of
 * single-use.
 */
@Injectable()
export class AttestationService {
  private readonly logger = new Logger(AttestationService.name);

  constructor(
    @Inject(ATTESTATION_NONCE_STORE)
    private readonly nonces: AttestationNonceStore,
    private readonly ios: AppAttestVerifier,
    private readonly android: KeyAttestationVerifier,
  ) {}

  issueNonce(userId: string): Promise<string> {
    return this.nonces.issue(userId);
  }

  async verify(
    userId: string,
    request: AttestationRequest,
  ): Promise<VerifiedAttestation> {
    const spent = await this.nonces.consume(userId, request.nonce);
    if (!spent) {
      throw new AttestationNonceError(
        'attestation nonce is unknown, expired or already used',
      );
    }

    const verified =
      request.platform === 'ios'
        ? await this.ios.verify(request.attestation, request.nonce)
        : await this.android.verify(request.attestation, request.nonce);

    this.logger.log(
      `attestation.verified userId=${userId} security=${verified.security}`,
    );
    return verified;
  }
}

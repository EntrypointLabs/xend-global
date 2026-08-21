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
      this.logger.warn(
        `attestation.rejected userId=${userId} reason=nonce platform=${request.platform}`,
      );
      throw new AttestationNonceError(
        'attestation nonce is unknown, expired or already used',
      );
    }

    // A rejection here is the single most likely reason an enrolment produced
    // nothing, and it is otherwise invisible: the controller turns it into a
    // 401 and the device is built to fail quietly. Log it before rethrowing so
    // the reason survives.
    let verified: VerifiedAttestation;
    try {
      verified =
        request.platform === 'ios'
          ? await this.ios.verify(
              request.attestation,
              request.nonce,
              request.hardwarePublicKey,
            )
          : await this.android.verify(request.attestation, request.nonce);
    } catch (err) {
      this.logger.warn(
        `attestation.rejected userId=${userId} platform=${request.platform}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }

    this.logger.log(
      `attestation.verified userId=${userId} security=${verified.security}`,
    );
    return verified;
  }
}

import { Injectable } from '@nestjs/common';
import * as asn1js from 'asn1js';
import * as x509 from '@peculiar/x509';
import { timingSafeEqual } from 'node:crypto';

import { AttestationRejectedError } from './attestation.errors';
import type { VerifiedAttestation } from './attestation.interface';
import { compressP256 } from './app-attest.verifier';
import { GOOGLE_ATTESTATION_ROOTS } from './roots';

/** Android's key attestation extension. */
const KEY_ATTESTATION_OID = '1.3.6.1.4.1.11129.2.1.17';

/**
 * SecurityLevel from the attestation schema. Software (0) means the key is not
 * in hardware at all, which is exactly the case this whole check exists to
 * reject.
 */
const SECURITY_LEVEL = { software: 0, trustedEnvironment: 1, strongBox: 2 };

/**
 * Verifies an Android hardware key attestation.
 *
 * The chain proves the leaf was issued by Google's attestation CA, and the
 * extension says what the device actually did. Both halves are needed: a valid
 * chain with `securityLevel: software` is a genuine Google-signed statement
 * that the key is *not* in hardware, and reading only the chain would treat
 * that as a pass.
 */
@Injectable()
export class KeyAttestationVerifier {
  async verify(
    attestation: string,
    nonce: string,
  ): Promise<VerifiedAttestation> {
    const chain = parseChain(attestation);
    await assertChainToGoogleRoot(chain);

    const leaf = chain[0];
    const record = parseAttestationExtension(leaf);

    assertChallenge(record.challenge, nonce);

    const security = readSecurityLevel(record.keymasterSecurityLevel);
    return {
      hardwarePublicKey: compressP256(uncompressedKey(leaf)).toString('hex'),
      security,
    };
  }
}

/** Base64 of a JSON array of PEM strings, leaf first. */
function parseChain(attestation: string): x509.X509Certificate[] {
  let pems: unknown;
  try {
    pems = JSON.parse(Buffer.from(attestation, 'base64').toString('utf8'));
  } catch {
    throw new AttestationRejectedError('attestation chain is not valid JSON');
  }

  if (!Array.isArray(pems) || pems.length === 0) {
    throw new AttestationRejectedError('attestation chain is empty');
  }

  try {
    return pems.map((pem) => new x509.X509Certificate(String(pem)));
  } catch (cause) {
    throw new AttestationRejectedError(
      `attestation chain did not parse: ${describe(cause)}`,
    );
  }
}

async function assertChainToGoogleRoot(
  chain: x509.X509Certificate[],
): Promise<void> {
  const roots = GOOGLE_ATTESTATION_ROOTS.map(
    (pem) => new x509.X509Certificate(pem),
  );
  const builder = new x509.X509ChainBuilder({
    certificates: [...chain, ...roots],
  });

  let built: x509.X509Certificate[];
  try {
    built = await builder.build(chain[0]);
  } catch (cause) {
    throw new AttestationRejectedError(
      `certificate chain did not build: ${describe(cause)}`,
    );
  }

  const anchor = built[built.length - 1];
  if (!anchor || !roots.some((root) => anchor.equal(root))) {
    throw new AttestationRejectedError(
      'certificate chain does not terminate at a Google attestation root',
    );
  }

  const now = new Date();
  for (const cert of built) {
    if (cert.notBefore > now || cert.notAfter < now) {
      throw new AttestationRejectedError(
        'certificate chain contains an expired certificate',
      );
    }
  }
}

interface AttestationRecord {
  challenge: Buffer;
  keymasterSecurityLevel: number;
}

/**
 * KeyDescription ::= SEQUENCE {
 *   attestationVersion INTEGER, attestationSecurityLevel ENUMERATED,
 *   keymasterVersion INTEGER, keymasterSecurityLevel ENUMERATED,
 *   attestationChallenge OCTET_STRING, uniqueId OCTET_STRING, ... }
 *
 * Only the first five fields are read. The authorization lists after them
 * describe key usage constraints, which the device enforces and which this
 * check does not need to re-derive.
 */
function parseAttestationExtension(
  leaf: x509.X509Certificate,
): AttestationRecord {
  const extension = leaf.getExtension(KEY_ATTESTATION_OID);
  if (!extension) {
    throw new AttestationRejectedError(
      'leaf certificate carries no key attestation extension, so the key is not attested',
    );
  }

  const parsed = asn1js.fromBER(extension.value);
  if (parsed.offset === -1) {
    throw new AttestationRejectedError(
      'key attestation extension is malformed',
    );
  }

  const values = (parsed.result as asn1js.Sequence).valueBlock.value;
  const securityLevel = values[3];
  const challenge = values[4];

  if (
    !(securityLevel instanceof asn1js.Enumerated) ||
    !(challenge instanceof asn1js.OctetString)
  ) {
    throw new AttestationRejectedError(
      'key attestation extension has an unexpected shape',
    );
  }

  return {
    keymasterSecurityLevel: securityLevel.valueBlock.valueDec,
    challenge: Buffer.from(challenge.valueBlock.valueHexView),
  };
}

function assertChallenge(challenge: Buffer, nonce: string): void {
  const expected = Buffer.from(nonce, 'utf8');
  if (
    challenge.length !== expected.length ||
    !timingSafeEqual(challenge, expected)
  ) {
    throw new AttestationRejectedError(
      'attestation was not produced for this nonce',
    );
  }
}

function readSecurityLevel(level: number): 'strongbox' | 'tee' {
  if (level === SECURITY_LEVEL.strongBox) return 'strongbox';
  if (level === SECURITY_LEVEL.trustedEnvironment) return 'tee';

  // StrongBox falls back to TEE silently, which is acceptable. Falling back to
  // software is not: the key would be extractable and S2 would be decorative.
  throw new AttestationRejectedError(
    `key is not hardware-backed (security level ${level})`,
  );
}

function uncompressedKey(leaf: x509.X509Certificate): Buffer {
  const spki = Buffer.from(leaf.publicKey.rawData);
  const point = spki.subarray(spki.length - 65);
  if (point.length !== 65 || point[0] !== 0x04) {
    throw new AttestationRejectedError(
      'leaf certificate does not carry an uncompressed P-256 key',
    );
  }
  return point;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

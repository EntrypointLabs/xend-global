import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as x509 from '@peculiar/x509';
import { decode as cborDecode } from 'cbor-x';
import { createHash, timingSafeEqual } from 'node:crypto';

import {
  AttestationNotConfiguredError,
  AttestationRejectedError,
} from './attestation.errors';
import type { VerifiedAttestation } from './attestation.interface';
import { APPLE_APP_ATTEST_ROOT } from './roots';

/** Apple's nonce lives in this certificate extension. */
const APPLE_NONCE_OID = '1.2.840.113635.100.8.2';

/** The two AAGUIDs Apple issues: development builds and everything else. */
const AAGUID_DEVELOPMENT = 'appattestdevelop';
const AAGUID_PRODUCTION = 'appattest\0\0\0\0\0\0\0';

/**
 * Verifies an iOS App Attest attestation, following Apple's published
 * procedure.
 *
 * Two steps carry the security and are worth naming, because both look like
 * bookkeeping and neither is:
 *
 * `nonce` binds the attestation to a challenge we issued, so a captured
 * attestation cannot be replayed. `keyIdentifier` binds it to the key being
 * enrolled, so a client cannot attest one key and enrol another. Skip either
 * and the remaining checks prove only that some genuine Apple device exists
 * somewhere.
 */
@Injectable()
export class AppAttestVerifier {
  constructor(private readonly config: ConfigService) {}

  async verify(
    attestation: string,
    nonce: string,
  ): Promise<VerifiedAttestation> {
    const appId = this.config.get<string>('IOS_APP_ATTEST_APP_ID');
    if (!appId) {
      throw new AttestationNotConfiguredError(
        'IOS_APP_ATTEST_APP_ID is not configured, so no iOS key can be proven hardware-backed',
      );
    }

    const object = decodeAttestation(attestation);
    const { credCert, chain } = parseChain(object.attStmt.x5c);

    await assertChainToAppleRoot(chain);
    assertNonce(credCert, object.authData, nonce);

    const publicKey = extractUncompressedKey(credCert);
    const authData = parseAuthData(object.authData);

    assertAppId(authData.rpIdHash, appId);
    assertKeyIdentifier(authData.credentialId, publicKey);

    // A fresh attested key has never signed, so its counter is 0. Anything
    // else means this is not a first attestation.
    if (authData.counter !== 0) {
      throw new AttestationRejectedError(
        `attestation counter is ${authData.counter}, expected 0`,
      );
    }

    return {
      hardwarePublicKey: compressP256(publicKey).toString('hex'),
      security: 'secure_enclave',
    };
  }
}

interface AppAttestObject {
  fmt: string;
  attStmt: { x5c: Uint8Array[] };
  authData: Uint8Array;
}

function decodeAttestation(attestation: string): AppAttestObject {
  let decoded: AppAttestObject;
  try {
    decoded = cborDecode(Buffer.from(attestation, 'base64')) as AppAttestObject;
  } catch {
    throw new AttestationRejectedError('attestation is not valid CBOR');
  }

  if (decoded?.fmt !== 'apple-appattest') {
    throw new AttestationRejectedError(
      `unexpected attestation format ${String(decoded?.fmt)}`,
    );
  }
  if (!decoded.attStmt?.x5c?.length || !decoded.authData) {
    throw new AttestationRejectedError('attestation is missing its statement');
  }
  return decoded;
}

function parseChain(x5c: Uint8Array[]) {
  const chain = x5c.map((der) => new x509.X509Certificate(new Uint8Array(der)));
  const credCert = chain[0];
  if (!credCert) {
    throw new AttestationRejectedError('attestation carries no certificate');
  }
  return { credCert, chain };
}

async function assertChainToAppleRoot(
  chain: x509.X509Certificate[],
): Promise<void> {
  const root = new x509.X509Certificate(APPLE_APP_ATTEST_ROOT);
  const builder = new x509.X509ChainBuilder({ certificates: [...chain, root] });

  let built: x509.X509Certificate[];
  try {
    built = await builder.build(chain[0]);
  } catch (cause) {
    throw new AttestationRejectedError(
      `certificate chain did not build: ${describe(cause)}`,
    );
  }

  const anchor = built[built.length - 1];
  // Building a chain is not the same as it ending where we require. Without
  // this an attacker-supplied self-signed chain builds perfectly well.
  if (!anchor || !anchor.equal(root)) {
    throw new AttestationRejectedError(
      'certificate chain does not terminate at the Apple App Attest root',
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

/**
 * Apple's nonce is SHA256(authData || SHA256(challenge)), stored in the
 * credCert extension as a DER SEQUENCE wrapping a context-tagged OCTET STRING.
 */
function assertNonce(
  credCert: x509.X509Certificate,
  authData: Uint8Array,
  challenge: string,
): void {
  const extension = credCert.getExtension(APPLE_NONCE_OID);
  if (!extension) {
    throw new AttestationRejectedError('credential certificate has no nonce');
  }

  const clientDataHash = sha256(Buffer.from(challenge, 'utf8'));
  const expected = sha256(
    Buffer.concat([Buffer.from(authData), clientDataHash]),
  );

  const raw = Buffer.from(extension.value);
  // The 32-byte digest is the tail of the DER wrapper; comparing by inclusion
  // avoids hand-rolling an ASN.1 reader for a fixed-shape structure.
  const found = raw.subarray(raw.length - 32);
  if (found.length !== 32 || !equal(found, expected)) {
    throw new AttestationRejectedError(
      'attestation was not produced for this nonce',
    );
  }
}

function extractUncompressedKey(credCert: x509.X509Certificate): Buffer {
  const spki = Buffer.from(credCert.publicKey.rawData);
  // Uncompressed P-256 points are 65 bytes starting 0x04, at the tail of SPKI.
  const point = spki.subarray(spki.length - 65);
  if (point.length !== 65 || point[0] !== 0x04) {
    throw new AttestationRejectedError(
      'credential certificate does not carry an uncompressed P-256 key',
    );
  }
  return point;
}

interface AuthData {
  rpIdHash: Buffer;
  counter: number;
  aaguid: string;
  credentialId: Buffer;
}

function parseAuthData(raw: Uint8Array): AuthData {
  const data = Buffer.from(raw);
  if (data.length < 55) {
    throw new AttestationRejectedError('authenticator data is too short');
  }

  const rpIdHash = data.subarray(0, 32);
  const counter = data.readUInt32BE(33);
  const aaguid = data.subarray(37, 53).toString('binary');
  const credentialIdLength = data.readUInt16BE(53);
  const credentialId = data.subarray(55, 55 + credentialIdLength);

  if (credentialId.length !== credentialIdLength) {
    throw new AttestationRejectedError('credential id is truncated');
  }
  if (aaguid !== AAGUID_DEVELOPMENT && aaguid !== AAGUID_PRODUCTION) {
    throw new AttestationRejectedError(`unexpected aaguid ${aaguid.trim()}`);
  }

  return { rpIdHash, counter, aaguid, credentialId };
}

function assertAppId(rpIdHash: Buffer, appId: string): void {
  if (!equal(rpIdHash, sha256(Buffer.from(appId, 'utf8')))) {
    throw new AttestationRejectedError(
      'attestation was produced for a different app',
    );
  }
}

function assertKeyIdentifier(credentialId: Buffer, publicKey: Buffer): void {
  if (!equal(credentialId, sha256(publicKey))) {
    throw new AttestationRejectedError(
      'attested key does not match the credential id',
    );
  }
}

/** SEC1 compression: 0x02 or 0x03 by the parity of Y, then X. */
export function compressP256(uncompressed: Buffer): Buffer {
  const x = uncompressed.subarray(1, 33);
  const y = uncompressed.subarray(33, 65);
  const prefix = (y[y.length - 1] & 1) === 0 ? 0x02 : 0x03;
  return Buffer.concat([Buffer.from([prefix]), x]);
}

function sha256(input: Buffer): Buffer {
  return createHash('sha256').update(input).digest();
}

function equal(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

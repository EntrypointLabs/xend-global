// @peculiar/x509 pulls in tsyringe, which needs the polyfill before it loads.
import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import * as x509 from '@peculiar/x509';
import { encode as cborEncode } from 'cbor-x';
import { webcrypto } from 'node:crypto';

import * as asn1js from 'asn1js';

import {
  AppAttestVerifier,
  compressP256,
  parseAuthData,
} from './app-attest.verifier';
import {
  AttestationNonceError,
  AttestationNotConfiguredError,
  AttestationRejectedError,
} from './attestation.errors';
import type {
  AttestationNonceStore,
  VerifiedAttestation,
} from './attestation.interface';
import { AttestationService } from './attestation.service';
import {
  ANDROID_PACKAGE_NAME,
  KeyAttestationVerifier,
  assertApplication,
  parseKeyDescription,
} from './key-attestation.verifier';

x509.cryptoProvider.set(webcrypto as Crypto);

const NONCE = 'test-nonce';
const APP_ID = 'TEAMID1234.com.giftedborg.xend';

/**
 * A self-signed chain: exactly what an attacker with no genuine device can
 * produce. Every verifier here must reject it.
 */
async function selfSignedChain(): Promise<x509.X509Certificate> {
  const keys = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify'],
  );
  return x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: '01',
    name: 'CN=Not Apple',
    notBefore: new Date(Date.now() - 60_000),
    notAfter: new Date(Date.now() + 3_600_000),
    signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
    keys: keys as CryptoKeyPair,
  });
}

function config(appId?: string, nodeEnv = 'test'): ConfigService {
  const values: Record<string, string | undefined> = {
    IOS_APP_ATTEST_APP_ID: appId,
    NODE_ENV: nodeEnv,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

/** Authenticator data carrying the given AAGUID and a one-byte credential id. */
function authDataWith(aaguid: string): Uint8Array {
  const data = Buffer.alloc(56);
  Buffer.from(aaguid, 'binary').copy(data, 37);
  data.writeUInt16BE(1, 53);
  return data;
}

/**
 * A KeyDescription the way an Android device emits one, with the application
 * id carried in the software-enforced list under its explicit tag.
 */
function keyDescription(packageNames: string[] | null): ArrayBuffer {
  const applicationId = packageNames
    ? new asn1js.Sequence({
        value: [
          new asn1js.Set({
            value: packageNames.map(
              (name) =>
                new asn1js.Sequence({
                  value: [
                    new asn1js.OctetString({
                      valueHex: Buffer.from(name, 'utf8'),
                    }),
                    new asn1js.Integer({ value: 1 }),
                  ],
                }),
            ),
          }),
          new asn1js.Set({ value: [] }),
        ],
      })
    : null;
  const softwareEnforced = new asn1js.Sequence({
    value: applicationId
      ? [
          new asn1js.Constructed({
            idBlock: { tagClass: 3, tagNumber: 709 },
            value: [
              new asn1js.OctetString({ valueHex: applicationId.toBER() }),
            ],
          }),
        ]
      : [],
  });
  return new asn1js.Sequence({
    value: [
      new asn1js.Integer({ value: 4 }),
      new asn1js.Enumerated({ value: 1 }),
      new asn1js.Integer({ value: 4 }),
      new asn1js.Enumerated({ value: 1 }),
      new asn1js.OctetString({ valueHex: Buffer.from(NONCE, 'utf8') }),
      new asn1js.OctetString({ valueHex: Buffer.alloc(0) }),
      softwareEnforced,
      new asn1js.Sequence({ value: [] }),
    ],
  }).toBER();
}

describe('AppAttestVerifier', () => {
  it('refuses to verify when the app id is not configured', async () => {
    // Failing closed matters more here than anywhere: an unconfigured verifier
    // that returned a pass would enrol every simulator on earth.
    await expect(
      new AppAttestVerifier(config(undefined)).verify('AA==', NONCE),
    ).rejects.toBeInstanceOf(AttestationNotConfiguredError);
  });

  it('rejects input that is not CBOR', async () => {
    await expect(
      new AppAttestVerifier(config(APP_ID)).verify('not-cbor', NONCE),
    ).rejects.toBeInstanceOf(AttestationRejectedError);
  });

  it('rejects an attestation in another format', async () => {
    const blob = Buffer.from(
      cborEncode({
        fmt: 'packed',
        attStmt: { x5c: [new Uint8Array([1])] },
        authData: new Uint8Array(64),
      }),
    ).toString('base64');

    await expect(
      new AppAttestVerifier(config(APP_ID)).verify(blob, NONCE),
    ).rejects.toThrow(/unexpected attestation format/);
  });

  it('refuses an iOS enrolment that names no Secure Enclave key', async () => {
    const cert = await selfSignedChain();
    const blob = Buffer.from(
      cborEncode({
        fmt: 'apple-appattest',
        attStmt: { x5c: [new Uint8Array(cert.rawData)] },
        authData: new Uint8Array(128),
      }),
    ).toString('base64');

    // Without one there is nothing to enrol but the App Attest key, which is
    // the key the app can never stamp Turnkey with.
    await expect(
      new AppAttestVerifier(config(APP_ID)).verify(blob, NONCE),
    ).rejects.toBeInstanceOf(AttestationRejectedError);
  });

  it('rejects a chain that does not reach the Apple root', async () => {
    const cert = await selfSignedChain();
    const blob = Buffer.from(
      cborEncode({
        fmt: 'apple-appattest',
        attStmt: { x5c: [new Uint8Array(cert.rawData)] },
        authData: new Uint8Array(128),
      }),
    ).toString('base64');

    await expect(
      new AppAttestVerifier(config(APP_ID)).verify(blob, NONCE, '02ab'),
    ).rejects.toBeInstanceOf(AttestationRejectedError);
  });
});

describe('parseAuthData', () => {
  const production = 'appattest\0\0\0\0\0\0\0';

  it('accepts a production key anywhere', () => {
    expect(parseAuthData(authDataWith(production), false).aaguid).toBe(
      production,
    );
  });

  it('accepts a development key only outside production', () => {
    expect(parseAuthData(authDataWith('appattestdevelop'), true).aaguid).toBe(
      'appattestdevelop',
    );
    // A test build carries this AAGUID with a genuine Apple chain, so letting
    // it through in production would enrol keys from builds we never shipped.
    expect(() =>
      parseAuthData(authDataWith('appattestdevelop'), false),
    ).toThrow(AttestationRejectedError);
  });

  it('rejects an AAGUID Apple never issues', () => {
    expect(() => parseAuthData(authDataWith('somethingelse!!!'), true)).toThrow(
      /unexpected aaguid/,
    );
  });
});

describe('parseKeyDescription', () => {
  it('reads the challenge and the packages the key was issued to', () => {
    const record = parseKeyDescription(keyDescription([ANDROID_PACKAGE_NAME]));

    expect(record.challenge.toString('utf8')).toBe(NONCE);
    expect(record.keymasterSecurityLevel).toBe(1);
    expect(record.packageNames).toEqual([ANDROID_PACKAGE_NAME]);
  });

  it('binds the attestation to our package', () => {
    // A genuine chain from any other app on the same phone would pass every
    // other check here.
    expect(() =>
      assertApplication(
        parseKeyDescription(keyDescription(['com.example.other'])).packageNames,
        ANDROID_PACKAGE_NAME,
      ),
    ).toThrow(/different app/);

    expect(() =>
      assertApplication(
        parseKeyDescription(keyDescription(null)).packageNames,
        ANDROID_PACKAGE_NAME,
      ),
    ).toThrow(/names no application/);

    expect(() =>
      assertApplication(
        parseKeyDescription(
          keyDescription(['com.example.other', ANDROID_PACKAGE_NAME]),
        ).packageNames,
        ANDROID_PACKAGE_NAME,
      ),
    ).not.toThrow();
  });
});

describe('KeyAttestationVerifier', () => {
  it('rejects input that is not a JSON chain', async () => {
    await expect(
      new KeyAttestationVerifier().verify(
        Buffer.from('nonsense').toString('base64'),
        NONCE,
      ),
    ).rejects.toThrow(/not valid JSON/);
  });

  it('rejects an empty chain', async () => {
    await expect(
      new KeyAttestationVerifier().verify(
        Buffer.from('[]').toString('base64'),
        NONCE,
      ),
    ).rejects.toThrow(/chain is empty/);
  });

  it('rejects a chain that does not reach a Google root', async () => {
    const cert = await selfSignedChain();
    const blob = Buffer.from(JSON.stringify([cert.toString('pem')])).toString(
      'base64',
    );

    // The self-signed cert also carries no attestation extension, but the
    // chain check has to be what stops it: an unrooted chain is untrusted
    // regardless of what its extensions claim.
    await expect(
      new KeyAttestationVerifier().verify(blob, NONCE),
    ).rejects.toThrow(/does not terminate at a Google attestation root/);
  });
});

describe('compressP256', () => {
  it('encodes the parity of Y in the prefix', () => {
    const even = Buffer.concat([
      Buffer.from([0x04]),
      Buffer.alloc(32, 1),
      Buffer.concat([Buffer.alloc(31, 0), Buffer.from([0x02])]),
    ]);
    const odd = Buffer.concat([
      Buffer.from([0x04]),
      Buffer.alloc(32, 1),
      Buffer.concat([Buffer.alloc(31, 0), Buffer.from([0x03])]),
    ]);

    expect(compressP256(even)[0]).toBe(0x02);
    expect(compressP256(odd)[0]).toBe(0x03);
    expect(compressP256(even)).toHaveLength(33);
  });
});

describe('AttestationService', () => {
  function fakeNonces(valid = new Set([NONCE])): AttestationNonceStore {
    return {
      issue: () => Promise.resolve(NONCE),
      consume: (_userId, nonce) => {
        const ok = valid.has(nonce);
        valid.delete(nonce);
        return Promise.resolve(ok);
      },
    };
  }

  const passing = {
    verify: () =>
      Promise.resolve<VerifiedAttestation>({
        hardwarePublicKey: '02ab',
        security: 'secure_enclave',
      }),
  } as unknown as AppAttestVerifier;

  it('rejects an unknown or spent nonce', async () => {
    const service = new AttestationService(
      fakeNonces(new Set()),
      passing,
      {} as KeyAttestationVerifier,
    );

    await expect(
      service.verify('user-1', {
        platform: 'ios',
        attestation: 'x',
        nonce: NONCE,
      }),
    ).rejects.toBeInstanceOf(AttestationNonceError);
  });

  it('spends the nonce before verifying, so a failed attempt burns it', async () => {
    const service = new AttestationService(
      fakeNonces(),
      {
        verify: () => Promise.reject(new AttestationRejectedError('bad')),
      } as unknown as AppAttestVerifier,
      {} as KeyAttestationVerifier,
    );

    const request = {
      platform: 'ios' as const,
      attestation: 'x',
      nonce: NONCE,
    };

    await expect(service.verify('user-1', request)).rejects.toBeInstanceOf(
      AttestationRejectedError,
    );
    // Verifying first and consuming after would let a client retry a single
    // nonce until one hand-crafted attestation happened to pass.
    await expect(service.verify('user-1', request)).rejects.toBeInstanceOf(
      AttestationNonceError,
    );
  });

  it('dispatches Android to the key attestation verifier', async () => {
    let called = false;
    const service = new AttestationService(fakeNonces(), passing, {
      verify: () => {
        called = true;
        return Promise.resolve<VerifiedAttestation>({
          hardwarePublicKey: '03cd',
          security: 'strongbox',
        });
      },
    } as unknown as KeyAttestationVerifier);

    const result = await service.verify('user-1', {
      platform: 'android',
      attestation: 'x',
      nonce: NONCE,
    });

    expect(called).toBe(true);
    expect(result.security).toBe('strongbox');
  });
});

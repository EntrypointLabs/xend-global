import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import {
  address,
  appendTransactionMessageInstructions,
  type Blockhash,
  compileTransaction,
  createKeyPairSignerFromPrivateKeyBytes,
  createTransactionMessage,
  getBase58Decoder,
  getBase64Encoder,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { getSetComputeUnitLimitInstruction } from "@solana-program/compute-budget";
import { randomBytes } from "node:crypto";
import { EnvKeySigner } from "./env-key.signer";
import { KmsKeySigner } from "./kms-key.signer";
import type { KmsClient } from "./kms.client";
import { selectFeePayerSigner } from "./signer.module";

function makeConfig(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      const value = values[key];
      if (value === undefined) throw new Error(`missing config ${key}`);
      return value;
    },
  } as unknown as ConfigService;
}

/** Xor against a fixed pad, so the fixture's "encrypt" is its own inverse. */
class FakeKms implements KmsClient {
  calls = 0;
  private readonly pad = Buffer.from("relayer-test-pad");

  wrap(plaintext: Buffer): string {
    return this.xor(plaintext).toString("base64");
  }

  decrypt(ciphertext: Uint8Array): Promise<Uint8Array> {
    this.calls++;
    return Promise.resolve(new Uint8Array(this.xor(Buffer.from(ciphertext))));
  }

  private xor(bytes: Buffer): Buffer {
    return Buffer.from(bytes.map((b, i) => b ^ this.pad[i % this.pad.length]));
  }
}

async function generateSecret(): Promise<{
  secretBase58: string;
  expectedAddress: string;
}> {
  const seed = new Uint8Array(randomBytes(32));
  const signer = await createKeyPairSignerFromPrivateKeyBytes(seed, true);
  const publicKeyBytes = new Uint8Array(
    await crypto.subtle.exportKey("raw", signer.keyPair.publicKey),
  );
  const secretBytes = new Uint8Array(64);
  secretBytes.set(seed, 0);
  secretBytes.set(publicKeyBytes, 32);
  return {
    secretBase58: getBase58Decoder().decode(secretBytes),
    expectedAddress: signer.address,
  };
}

function unsignedWireTx(feePayer: string): string {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(address(feePayer), m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: feePayer as Blockhash, lastValidBlockHeight: 1_000n },
        m,
      ),
    (m) =>
      appendTransactionMessageInstructions(
        [getSetComputeUnitLimitInstruction({ units: 60_000 })],
        m,
      ),
  );
  return getBase64EncodedWireTransaction(compileTransaction(message));
}

describe("KmsKeySigner", () => {
  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest
      .spyOn(Logger.prototype, "log")
      .mockImplementation(() => undefined);
  });
  afterEach(() => logSpy.mockRestore());

  it("decrypts the ciphertext once, derives the address, and co-signs", async () => {
    const { secretBase58, expectedAddress } = await generateSecret();
    const kms = new FakeKms();
    const config = makeConfig({
      RELAYER_FEE_PAYER_SECRET_KEY_CIPHERTEXT: kms.wrap(
        Buffer.from(secretBase58, "utf-8"),
      ),
    });

    const signer = await KmsKeySigner.create(config, kms);
    expect(signer.address).toBe(expectedAddress);
    expect(kms.calls).toBe(1);

    await signer.onModuleInit();
    const signed = await signer.signTransaction(
      unsignedWireTx(expectedAddress),
    );
    const decoded = getTransactionDecoder().decode(
      getBase64Encoder().encode(signed),
    );
    expect(decoded.signatures[address(expectedAddress)]).not.toBeNull();

    const logged = (logSpy.mock.calls as unknown[][])
      .map((c) => String(c[0]))
      .join("\n");
    expect(logged).toContain("provider=aws-kms");
    expect(logged).not.toContain(secretBase58);
  });

  it("refuses a ciphertext that does not unwrap to a 64-byte key", async () => {
    const kms = new FakeKms();
    const config = makeConfig({
      RELAYER_FEE_PAYER_SECRET_KEY_CIPHERTEXT: kms.wrap(Buffer.from("short")),
    });
    await expect(KmsKeySigner.create(config, kms)).rejects.toThrow(/64-byte/);
  });
});

describe("selectFeePayerSigner", () => {
  it("defaults to the env signer", async () => {
    const { secretBase58 } = await generateSecret();
    const signer = await selectFeePayerSigner(
      makeConfig({ RELAYER_FEE_PAYER_SECRET_KEY: secretBase58 }),
      new FakeKms(),
    );
    expect(signer).toBeInstanceOf(EnvKeySigner);
  });

  it("selects the KMS signer on aws-kms and refuses anything else", async () => {
    const { secretBase58 } = await generateSecret();
    const kms = new FakeKms();
    const signer = await selectFeePayerSigner(
      makeConfig({
        RELAYER_FEE_PAYER_PROVIDER: "aws-kms",
        RELAYER_FEE_PAYER_SECRET_KEY_CIPHERTEXT: kms.wrap(
          Buffer.from(secretBase58, "utf-8"),
        ),
      }),
      kms,
    );
    expect(signer).toBeInstanceOf(KmsKeySigner);
    expect(() =>
      selectFeePayerSigner(
        makeConfig({ RELAYER_FEE_PAYER_PROVIDER: "vault" }),
        kms,
      ),
    ).toThrow(/unknown RELAYER_FEE_PAYER_PROVIDER/);
  });
});

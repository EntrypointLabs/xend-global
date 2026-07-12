import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createKeyPairSignerFromBytes,
  getBase58Decoder,
  getBase58Encoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  partiallySignTransaction,
  type KeyPairSigner,
  type ReadonlyUint8Array,
} from "@solana/kit";
import type { FeePayerSigner } from "./signer.interface";

/**
 * Pilot-floor signer: loads the fee-payer key from env. The key is read
 * once at boot via config.getOrThrow and never logged (only the derived
 * public address is logged, mirroring helius.adapter.ts). Swapping to a
 * Turnkey / KMS signer is a new adapter behind FEE_PAYER_SIGNER, with no
 * change to the co-sign pipeline.
 *
 * The address is derived synchronously in the constructor so RELAYER_CONFIG
 * (which pins the expected fee payer) can read it during DI factory
 * assembly, before async lifecycle hooks run. A Solana 64-byte secret key
 * is seed(32) || publicKey(32), so the address is base58(bytes[32:64]); the
 * async keypair build in onModuleInit re-derives it and asserts a match.
 */
@Injectable()
export class EnvKeySigner implements FeePayerSigner, OnModuleInit {
  private readonly logger = new Logger("RelayerSigner");
  private readonly secretBytes: ReadonlyUint8Array;
  private readonly _address: string;
  private signer!: KeyPairSigner;

  constructor(private readonly config: ConfigService) {
    const secretBase58 = this.config.getOrThrow<string>(
      "RELAYER_FEE_PAYER_SECRET_KEY",
    );
    this.secretBytes = getBase58Encoder().encode(secretBase58);
    if (this.secretBytes.length !== 64) {
      throw new Error(
        "RELAYER_FEE_PAYER_SECRET_KEY must decode to a 64-byte Ed25519 secret key",
      );
    }
    this._address = getBase58Decoder().decode(this.secretBytes.slice(32, 64));
  }

  async onModuleInit(): Promise<void> {
    this.signer = await createKeyPairSignerFromBytes(this.secretBytes);
    if (this.signer.address !== this._address) {
      throw new Error("fee-payer address mismatch after keypair construction");
    }
    // Never log the key. Only the public address.
    this.logger.log(`relayer.signer.ready address=${this._address}`);
  }

  get address(): string {
    return this._address;
  }

  async signTransaction(wireTxBase64: string): Promise<string> {
    const txBytes = getBase64Encoder().encode(wireTxBase64);
    const tx = getTransactionDecoder().decode(txBytes);
    // partiallySignTransaction adds the fee-payer signature and preserves
    // every existing signature (the Consumer's), because it signs the same
    // messageBytes without recompiling the message.
    const signed = await partiallySignTransaction([this.signer.keyPair], tx);
    return getBase64EncodedWireTransaction(signed);
  }
}

import { requireNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

/**
 * The approval signer's key (S2 in ADR 0025): a P-256 keypair generated inside
 * the phone's secure hardware and gated on biometrics.
 *
 * Turnkey's shipped React Native stamper is deliberately not used. It generates
 * the key in JavaScript and stores it through `react-native-keychain`, so the
 * key is software-held and extractable. That forfeits the possession anchor
 * entirely, which is the only thing S2 contributes to the threshold.
 *
 * Nothing here can prove the key is really in hardware. The iOS simulator
 * satisfies `kSecAttrTokenIDSecureEnclave` against a host-side software
 * implementation, and Android falls back from StrongBox to TEE silently, so at
 * this layer a fake is indistinguishable from the real thing. Proof comes from
 * the attestation the backend verifies, never from this module.
 */

interface NativeHardwareKey {
  /**
   * Creates the key and returns an attestation over `nonce`.
   *
   * Replaces any existing key: enrolment is once per device, and a second call
   * means the first key is gone or unusable.
   */
  enrol(nonce: string): Promise<{
    /** Base64. The App Attest object on iOS, the certificate chain on Android. */
    attestation: string;
    /** Compressed P-256 public key, hex. */
    publicKey: string;
  }>;

  /** Compressed P-256 public key, hex, or null when no key exists. */
  getPublicKey(): Promise<string | null>;

  /**
   * Signs 32 bytes, prompting for biometrics.
   *
   * `payloadHex` must already be the digest Turnkey stamps over. Signing an
   * arbitrary payload here would make the biometric prompt a formality.
   */
  sign(payloadHex: string): Promise<string>;

  /** Discards the key. Used when enrolment fails part-way. */
  reset(): Promise<void>;
}

const native = requireNativeModule<NativeHardwareKey>("HardwareKey");

export type DevicePlatform = "ios" | "android";

export function devicePlatform(): DevicePlatform {
  return Platform.OS === "ios" ? "ios" : "android";
}

export const hardwareKey = native;

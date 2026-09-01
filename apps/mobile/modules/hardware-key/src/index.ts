import { requireNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

import { accountScope } from "./accountScope";

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
   * Replaces this account's existing key, and only this account's: enrolment is
   * once per account per device, and a second call means that key is gone or
   * unusable.
   */
  enrol(
    nonce: string,
    account: string
  ): Promise<{
    /** Base64. The App Attest object on iOS, the certificate chain on Android. */
    attestation: string;
    /** Compressed P-256 public key, hex. */
    publicKey: string;
  }>;

  /** Compressed P-256 public key, hex, or null when no key exists. */
  getPublicKey(account: string): Promise<string | null>;

  /**
   * Signs 32 bytes, prompting for biometrics.
   *
   * `payloadHex` must already be the digest Turnkey stamps over. Signing an
   * arbitrary payload here would make the biometric prompt a formality.
   *
   * The copy is the caller's to supply, because this key signs account setup as
   * well as payments and the prompt is the only thing telling a Consumer which
   * one they are agreeing to. Android shows `title` above `reason`; iOS has a
   * single line and shows `reason`.
   */
  sign(
    payloadHex: string,
    title: string,
    reason: string,
    account: string
  ): Promise<string>;

  /** Discards the key. Used when enrolment fails part-way. */
  reset(account: string): Promise<void>;
}

const native = requireNativeModule<NativeHardwareKey>("HardwareKey");

export type DevicePlatform = "ios" | "android";

export function devicePlatform(): DevicePlatform {
  return Platform.OS === "ios" ? "ios" : "android";
}

/**
 * The approval key, scoped to whoever is signed in.
 *
 * The scope is resolved here rather than passed by callers. It decides which
 * private key signs, so a call site that got it wrong would either fail to sign
 * or, worse, enrol over another account's key. One place to be right is the
 * whole point.
 */
export const hardwareKey = {
  enrol: async (nonce: string) => native.enrol(nonce, await accountScope()),
  getPublicKey: async () => native.getPublicKey(await accountScope()),
  sign: async (payloadHex: string, title: string, reason: string) =>
    native.sign(payloadHex, title, reason, await accountScope()),
  reset: async () => native.reset(await accountScope()),
};

/**
 * What the biometric prompt says, per thing being signed.
 *
 * Kept together so they stay visibly different. They were one hardcoded
 * string, which meant finishing onboarding asked a Consumer to "approve this
 * payment" when no payment existed and their balance was zero.
 */
export const SIGN_PROMPT = {
  payment: {
    title: "Approve this payment",
    reason: "Confirm it is you before Xend sends this",
  },
  accountSetup: {
    title: "Finish setting up",
    reason: "Confirm it is you to secure your Xend account",
  },
  // Worded around the money rather than the mechanism. This is the prompt on an
  // ordinary send, where the Consumer has no reason to know a second key exists
  // and every reason to be told what is about to leave.
  send: {
    title: "Confirm this send",
    reason: "Check it is you before Xend sends this money",
  },
  // Worded as stopping rather than approving. This is the one prompt a
  // Consumer may reach while being attacked, and "approve" is the last word
  // they should read on the way to refusing something.
  rejectChange: {
    title: "Stop this change",
    reason: "Confirm it is you before Xend refuses it",
  },
  replacePasskey: {
    title: "Approve your new passkey",
    reason: "Confirm it is you replacing the passkey on your account",
  },
} as const;

export type SignPrompt = (typeof SIGN_PROMPT)[keyof typeof SIGN_PROMPT];

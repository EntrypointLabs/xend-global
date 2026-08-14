import * as Crypto from "expo-crypto";

import { hardwareKey, type SignPrompt } from "./index";
import { normaliseLowS } from "./lowS";

/**
 * Stamps Turnkey requests with the Secure Enclave / StrongBox key.
 *
 * Turnkey ships a React Native stamper and it is deliberately not used here:
 * it generates the P-256 key in JavaScript and stores it via
 * react-native-keychain, so the key is software-held and extractable. S2 exists
 * to be the possession factor, and a key that can be copied off the device is
 * not one.
 */
export interface Stamp {
  stampHeaderName: string;
  stampHeaderValue: string;
}

const HEADER_NAME = "X-Stamp";
const SCHEME = "SIGNATURE_SCHEME_TK_API_P256";

export async function stamp(
  payload: string,
  prompt: SignPrompt
): Promise<Stamp> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    payload,
    { encoding: Crypto.CryptoEncoding.HEX }
  );

  const publicKey = await hardwareKey.getPublicKey();
  if (!publicKey) {
    throw new Error("No approval key on this device");
  }

  const signature = normaliseLowS(
    await hardwareKey.sign(digest, prompt.title, prompt.reason)
  );

  return {
    stampHeaderName: HEADER_NAME,
    stampHeaderValue: base64url(
      JSON.stringify({ publicKey, scheme: SCHEME, signature })
    ),
  };
}

function base64url(value: string): string {
  // Hermes has btoa but not the url-safe alphabet.
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

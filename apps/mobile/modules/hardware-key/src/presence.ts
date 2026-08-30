import * as Crypto from "expo-crypto";
import { VersionedTransaction } from "@solana/web3.js";
import { toByteArray } from "base64-js";

import { hardwareKey, type SignPrompt } from "./index";
import { normaliseLowS } from "./lowS";

/**
 * Proves the Consumer was here for this Spend.
 *
 * Under the spending limit a Spend lands on one signature, and that signature
 * comes from the Privy wallet, which signs from a session opened at login. So
 * an unlocked phone left on a desk is enough to move money, which is the one
 * thing the daily limit was never meant to allow.
 *
 * The device key is the only key on the phone that cannot be used without a
 * face or a fingerprint, and the backend already holds its attested public half.
 * Signing the prepared message with it puts a biometric in front of every Spend
 * without adding a signer or changing what lands on chain.
 *
 * Not needed above the limit: the approval signature is this same key behind
 * this same prompt, so asking again would prompt twice for one send.
 */

/** Must match PRESENCE_DOMAIN in apps/backend/src/transfer/presence-proof.ts. */
const PRESENCE_DOMAIN = "xend:spend-presence:v1";

/**
 * Signs the message inside a prepared transaction, not the transaction.
 *
 * Signature slots are part of the serialized transaction and are still empty
 * here, so hashing the whole thing would commit to a byte range that changes
 * the moment anything signs. The message is the recipient, the mint and the
 * amount, and it is what the backend pins the submitted transaction to.
 */
export async function signPresenceProof(
  unsignedTxBase64: string,
  prompt: SignPrompt
): Promise<string> {
  const message = VersionedTransaction.deserialize(
    toByteArray(unsignedTxBase64)
  ).message.serialize();

  const digest = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    concat(new TextEncoder().encode(PRESENCE_DOMAIN), message)
  );

  return normaliseLowS(
    await hardwareKey.sign(toHex(digest), prompt.title, prompt.reason)
  );
}

// Backed by an explicit ArrayBuffer: expo-crypto's BufferSource will not accept
// a view that TypeScript thinks might sit on a SharedArrayBuffer.
function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(a.length + b.length));
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

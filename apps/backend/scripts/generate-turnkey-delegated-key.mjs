/*
 * Generates the backend's delegated Turnkey API key (O6).
 *
 *   node scripts/generate-turnkey-delegated-key.mjs
 *
 * This is a SECOND keypair, separate from the parent organization's API key.
 * It is a root user on each Consumer's sub-organization only for the length of
 * enrolment and is narrowed out of the quorum before the sub-org is returned.
 *
 * Turnkey wants P-256 with the private key as 32-byte hex and the public key
 * SEC1-compressed as 33-byte hex, which is what this prints.
 */
import { generateKeyPairSync, createPrivateKey } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});

// The raw scalar sits at the end of the PKCS#8 DER for P-256.
const jwk = createPrivateKey(
  privateKey.export({ type: "pkcs8", format: "pem" }),
).export({ format: "jwk" });

const privateHex = Buffer.from(jwk.d, "base64url").toString("hex");
const x = Buffer.from(jwk.x, "base64url");
const y = Buffer.from(jwk.y, "base64url");
const prefix = (y[y.length - 1] & 1) === 0 ? 0x02 : 0x03;
const publicHex = Buffer.concat([Buffer.from([prefix]), x]).toString("hex");

if (privateHex.length !== 64 || publicHex.length !== 66) {
  throw new Error("unexpected key length; refusing to print a malformed key");
}

console.log("");
console.log("Paste into apps/backend/.env, then delete this output:");
console.log("");
console.log(`TURNKEY_DELEGATED_PUBLIC_KEY=${publicHex}`);
console.log("");
console.log("Private half. It never leaves the backend, and Turnkey never sees it:");
console.log("");
console.log(`TURNKEY_DELEGATED_PRIVATE_KEY=${privateHex}`);
console.log("");
console.log(
  "Uncompressed public key, in case Turnkey's dashboard asks for that form:",
);
console.log(
  `04${x.toString("hex")}${y.toString("hex")}`,
);
console.log("");
void publicKey;

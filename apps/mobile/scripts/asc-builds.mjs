// Lists the newest App Store Connect builds for the app, with Apple's
// processing state. A build is testable in TestFlight once it reads VALID.
//
// Reads the same App Store Connect API key eas-cli uses:
//   EXPO_ASC_API_KEY_PATH, EXPO_ASC_KEY_ID, EXPO_ASC_ISSUER_ID, ASC_APP_ID
//
//   node scripts/asc-builds.mjs
import { Buffer } from "node:buffer";
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";

function required(name, value) {
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const EXPO_ASC_API_KEY_PATH = required(
  "EXPO_ASC_API_KEY_PATH",
  process.env.EXPO_ASC_API_KEY_PATH
);
const EXPO_ASC_KEY_ID = required(
  "EXPO_ASC_KEY_ID",
  process.env.EXPO_ASC_KEY_ID
);
const EXPO_ASC_ISSUER_ID = required(
  "EXPO_ASC_ISSUER_ID",
  process.env.EXPO_ASC_ISSUER_ID
);
const ASC_APP_ID = required("ASC_APP_ID", process.env.ASC_APP_ID);

const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const unsigned = [
  encode({ alg: "ES256", kid: EXPO_ASC_KEY_ID, typ: "JWT" }),
  encode({
    iss: EXPO_ASC_ISSUER_ID,
    iat: now,
    exp: now + 600,
    aud: "appstoreconnect-v1",
  }),
].join(".");
const signature = sign("sha256", Buffer.from(unsigned), {
  key: createPrivateKey(readFileSync(EXPO_ASC_API_KEY_PATH)),
  dsaEncoding: "ieee-p1363",
}).toString("base64url");

const url = new URL("https://api.appstoreconnect.apple.com/v1/builds");
url.searchParams.set("filter[app]", ASC_APP_ID);
url.searchParams.set("sort", "-uploadedDate");
url.searchParams.set("limit", "5");
url.searchParams.set("fields[builds]", "version,uploadedDate,processingState");

const response = await fetch(url, {
  headers: { Authorization: `Bearer ${unsigned}.${signature}` },
});
if (!response.ok) {
  throw new Error(
    `App Store Connect answered ${response.status}: ${await response.text()}`
  );
}
const { data } = await response.json();
if (data.length === 0) console.log("No builds uploaded yet.");
for (const { attributes } of data) {
  console.log(
    `build ${attributes.version}  ${attributes.processingState}  ${attributes.uploadedDate}`
  );
}

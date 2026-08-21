/*
 * Settles O6 empirically, on a throwaway sub-organization.
 *
 *   node --env-file=.env scripts/smoke-test-o6.mjs
 *
 * ## The question
 *
 * O6 chose a delegated POLICY user over putting the backend in each Consumer's
 * root quorum. The reasoning: a root-quorum member can register its own
 * authenticator on the approval-signer wallet and then sign as S2, and the
 * backend already holds S3, so one compromise would reach threshold.
 *
 * That follows Turnkey's documented model but has never been exercised against
 * their API. The choice cannot be undone once real sub-organizations exist,
 * because widening a root quorum later needs the end user's approval.
 *
 * ## What this does
 *
 * Creates a sub-org with the backend's delegated key in the root quorum, then
 * tries to add a new API key to the *other* root user using only that key. It
 * deletes the sub-org either way.
 *
 *   Succeeds -> a root-quorum backend can mint itself an authenticator on
 *               another user. O6 stands exactly as written.
 *   Fails    -> it cannot, so root-quorum membership is less dangerous than
 *               assumed and O6 is worth reopening on the merits. Do that
 *               BEFORE the first real Consumer.
 *
 * Nothing here touches production data: the sub-org is created and destroyed
 * inside this script and no Consumer is involved.
 */
import { generateKeyPairSync, createPrivateKey } from "node:crypto";

import { Turnkey } from "@turnkey/sdk-server";

const required = (name) => {
  const value = process.env[name];
  if (!value) {
    console.error(`\n${name} is not set. Run with --env-file=.env\n`);
    process.exit(1);
  }
  return value;
};

const organizationId = required("TURNKEY_ORGANIZATION_ID");
const apiBaseUrl = process.env.TURNKEY_API_BASE_URL ?? "https://api.turnkey.com";

const parent = new Turnkey({
  apiBaseUrl,
  apiPublicKey: required("TURNKEY_API_PUBLIC_KEY"),
  apiPrivateKey: required("TURNKEY_API_PRIVATE_KEY"),
  defaultOrganizationId: organizationId,
}).apiClient();

const delegatedPublicKey = required("TURNKEY_DELEGATED_PUBLIC_KEY");
const delegated = new Turnkey({
  apiBaseUrl,
  apiPublicKey: delegatedPublicKey,
  apiPrivateKey: required("TURNKEY_DELEGATED_PRIVATE_KEY"),
  defaultOrganizationId: organizationId,
}).apiClient();

/** Stands in for a Consumer's device key. Discarded with the sub-org. */
function throwawayPublicKey() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = createPrivateKey(
    privateKey.export({ type: "pkcs8", format: "pem" }),
  ).export({ format: "jwk" });
  const x = Buffer.from(jwk.x, "base64url");
  const y = Buffer.from(jwk.y, "base64url");
  const prefix = (y[y.length - 1] & 1) === 0 ? 0x02 : 0x03;
  return Buffer.concat([Buffer.from([prefix]), x]).toString("hex");
}

const line = (text = "") => console.log(text);

async function main() {
  line();
  line("O6 smoke test: can a root-quorum member mint an authenticator?");
  line("--------------------------------------------------------------");

  const devicePublicKey = throwawayPublicKey();

  line("1. Creating a throwaway sub-organization...");
  const created = await parent.createSubOrganization({
    subOrganizationName: `o6-smoke-test-${Date.now()}`,
    rootQuorumThreshold: 1,
    rootUsers: [
      {
        userName: "xend-delegated",
        apiKeys: [
          {
            apiKeyName: "xend-delegated",
            publicKey: delegatedPublicKey,
            curveType: "API_KEY_CURVE_P256",
          },
        ],
        authenticators: [],
        oauthProviders: [],
      },
      {
        userName: "consumer-device",
        apiKeys: [
          {
            apiKeyName: "device-hardware-key",
            publicKey: devicePublicKey,
            curveType: "API_KEY_CURVE_P256",
          },
        ],
        authenticators: [],
        oauthProviders: [],
      },
    ],
    wallet: {
      walletName: "approval-signer",
      accounts: [
        {
          curve: "CURVE_ED25519",
          pathFormat: "PATH_FORMAT_BIP32",
          path: "m/44'/501'/0'/0'",
          addressFormat: "ADDRESS_FORMAT_SOLANA",
        },
      ],
    },
    disableEmailAuth: true,
    disableEmailRecovery: true,
    disableOtpEmailAuth: true,
    disableSmsAuth: true,
  });

  const subOrganizationId = created.subOrganizationId;
  line(`   sub-org ${subOrganizationId}`);

  let verdict;
  try {
    const [, consumerUserId] = created.rootUserIds ?? [];
    if (!consumerUserId) throw new Error("no consumer root user came back");

    line("2. Trying to add an API key to the OTHER root user,");
    line("   signed only by the delegated key...");

    await delegated.createApiKeys({
      organizationId: subOrganizationId,
      userId: consumerUserId,
      apiKeys: [
        {
          apiKeyName: "o6-smoke-test-injected",
          publicKey: throwawayPublicKey(),
          curveType: "API_KEY_CURVE_P256",
        },
      ],
    });

    verdict = {
      succeeded: true,
      message:
        "A root-quorum member CAN mint an authenticator on another user.\n" +
        "   O6 stands as written: keep the backend OUT of the root quorum.\n" +
        "   No change needed. The adapter already narrows it out at enrolment.",
    };
  } catch (error) {
    verdict = {
      succeeded: false,
      message:
        "A root-quorum member could NOT mint that authenticator.\n" +
        `   Turnkey said: ${error instanceof Error ? error.message : String(error)}\n` +
        "   O6's threat model is weaker than assumed, so root-quorum\n" +
        "   membership may be admissible. Worth reopening BEFORE the first\n" +
        "   real Consumer, because the choice is per sub-org and permanent.",
    };
  } finally {
    line("3. Deleting the throwaway sub-organization...");
    try {
      await delegated.deleteSubOrganization({
        organizationId: subOrganizationId,
        deleteWithoutExport: true,
      });
      line("   deleted");
    } catch (error) {
      // Worth saying loudly: a leftover sub-org is harmless but untidy, and
      // silently swallowing this would hide a permissions surprise.
      line(
        `   COULD NOT DELETE ${subOrganizationId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      line("   Remove it from the Turnkey dashboard by hand.");
    }
  }

  line();
  line("Result");
  line("------");
  line(`   ${verdict.message}`);
  line();
}

main().catch((error) => {
  console.error("\nSmoke test could not run:");
  console.error(error instanceof Error ? error.message : error);
  console.error(
    "\nIf this is an auth error, check that TURNKEY_API_PUBLIC_KEY is a key\n" +
      "Turnkey issued in the dashboard, not one generated locally.\n",
  );
  process.exit(1);
});

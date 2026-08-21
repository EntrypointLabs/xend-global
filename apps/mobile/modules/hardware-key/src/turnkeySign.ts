import type { SignPrompt } from "./index";
import { stamp } from "./stamper";

/**
 * Adds the approval signer's signature (S2) to a Solana transaction.
 *
 * The device talks to Turnkey directly. The backend deliberately never holds
 * anything that can produce this signature: it already holds the recovery
 * signer, and a backend that could also sign as S2 would hold two of the three
 * signers, which is the threshold.
 *
 * This has to run BEFORE the primary signs. `SIGN_TRANSACTION_V2` is specified
 * as unsigned payload in, signed transaction out; nothing promises it keeps a
 * signature already sitting on the input, and Turnkey exposes `addSignature`
 * precisely because this activity is not additive. `addSignature` is not the
 * way out either: it skips the Policy Engine, which is the only thing making S2
 * an approval rather than a rubber stamp. So Turnkey signs the clean payload,
 * its policy evaluates what it was actually asked to approve, and the primary
 * fills its own slot afterwards.
 */

const ENDPOINT = "https://api.turnkey.com/public/v1/submit/sign_transaction";

export interface TurnkeySignParams {
  /** The Consumer's Turnkey sub-organization. */
  organizationId: string;
  /** S2's Solana address, which is what Turnkey signs with. */
  signWith: string;
  /** The transaction, hex, with every signature slot still empty. */
  unsignedTransaction: string;
  /** What the biometric prompt says. See SIGN_PROMPT. */
  prompt: SignPrompt;
}

export async function signWithApprovalSigner({
  organizationId,
  signWith,
  unsignedTransaction,
  prompt,
}: TurnkeySignParams): Promise<string> {
  const body = JSON.stringify({
    type: "ACTIVITY_TYPE_SIGN_TRANSACTION_V2",
    timestampMs: String(Date.now()),
    organizationId,
    parameters: {
      signWith,
      unsignedTransaction,
      type: "TRANSACTION_TYPE_SOLANA",
    },
  });

  // Stamped over the exact bytes sent. Serialising twice would risk a
  // different key order and a stamp that does not match the body.
  const { stampHeaderName, stampHeaderValue } = await stamp(body, prompt);

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [stampHeaderName]: stampHeaderValue,
    },
    body,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Approval signer refused: ${payload?.message ?? response.status}`
    );
  }

  const signed =
    payload?.activity?.result?.signTransactionResult?.signedTransaction;
  if (typeof signed !== "string" || signed.length === 0) {
    // A pending activity means Turnkey wants another approval, which for this
    // sub-org shape should never happen. Failing here is better than returning
    // the unsigned transaction and letting it be rejected on chain.
    throw new Error(
      `Approval signer returned no signature (status ${
        payload?.activity?.status ?? "unknown"
      })`
    );
  }
  return signed;
}

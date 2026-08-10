import { stamp } from "./stamper";

/**
 * Adds the approval signer's signature (S2) to a Solana transaction.
 *
 * The device talks to Turnkey directly. The backend deliberately never holds
 * anything that can produce this signature: it already holds the recovery
 * signer, and a backend that could also sign as S2 would hold two of the three
 * signers, which is the threshold.
 *
 * `SIGN_TRANSACTION_V2` **preserves** a signature already on the transaction,
 * which is what lets the primary sign first and this add to it rather than
 * replace it. That behaviour is demonstrated by Turnkey's own fee-payer example
 * rather than promised in writing, so it is smoke-tested on devnet before the
 * send path depends on it (see the runbook).
 */

const ENDPOINT = "https://api.turnkey.com/public/v1/submit/sign_transaction";

export interface TurnkeySignParams {
  /** The Consumer's Turnkey sub-organization. */
  organizationId: string;
  /** S2's Solana address, which is what Turnkey signs with. */
  signWith: string;
  /** The transaction so far, hex. Already carrying the primary signature. */
  unsignedTransaction: string;
}

export async function signWithApprovalSigner({
  organizationId,
  signWith,
  unsignedTransaction,
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
  const { stampHeaderName, stampHeaderValue } = await stamp(body);

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

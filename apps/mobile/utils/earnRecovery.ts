import { Buffer } from "buffer";
import {
  VersionedTransaction,
  type Connection,
  type SignatureStatus,
} from "@solana/web3.js";

export interface PendingEarnApproval {
  signed: string;
  signature?: string;
  lastValidBlockHeight?: number;
}
export type EarnApprovalOutcome =
  | "pending"
  | "confirmed"
  | "failed"
  | "expired";
type RecoveryRpc = Pick<
  Connection,
  "getSignatureStatus" | "getBlockHeight" | "isBlockhashValid"
>;
function outcome(status: SignatureStatus | null): EarnApprovalOutcome {
  if (status?.err) return "failed";
  if (
    status?.confirmationStatus === "confirmed" ||
    status?.confirmationStatus === "finalized"
  )
    return "confirmed";
  return "pending";
}
/** Resolve the same saved approval; never infer failure from a submission error. */
export async function readEarnApprovalOutcome(
  rpc: RecoveryRpc,
  approval: PendingEarnApproval
): Promise<EarnApprovalOutcome> {
  if (!approval.signature) return "pending";
  const history = { searchTransactionHistory: true };
  const first = await rpc.getSignatureStatus(approval.signature, history);
  if (first.value) return outcome(first.value);
  if (
    approval.lastValidBlockHeight !== undefined &&
    Number.isSafeInteger(approval.lastValidBlockHeight) &&
    approval.lastValidBlockHeight >= 0
  ) {
    if (
      (await rpc.getBlockHeight("finalized")) <= approval.lastValidBlockHeight
    )
      return "pending";
  }
  {
    // Verify the signed blockhash too, rather than trusting unsigned height
    // metadata. Older saved approvals rely on this check alone. A fresh
    // confirmed hash may not exist in the finalized bank yet.
    const tx = VersionedTransaction.deserialize(
      Buffer.from(approval.signed, "base64")
    );
    const validity = await Promise.all(
      (["confirmed", "finalized"] as const).map((commitment) =>
        rpc.isBlockhashValid(tx.message.recentBlockhash, { commitment })
      )
    );
    if (validity.some((result) => result.value)) return "pending";
  }
  // Re-read history AFTER establishing finalized expiry: the transaction may
  // have landed between the first status read and the expiry check.
  const final = await rpc.getSignatureStatus(approval.signature, history);
  return final.value ? outcome(final.value) : "expired";
}

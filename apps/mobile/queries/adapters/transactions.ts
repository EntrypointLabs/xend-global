import type {
  TransactionsDto,
  TransactionRowDto,
  GridTransferDto,
} from "@/types/Backend";
import type { Transaction, TransactionStatus } from "@/types/Transaction";

/**
 * Map the wire-shape backend response onto the UI's `Transaction[]`.
 *
 * Dedupe rules (per Clarify #2 + research/SUMMARY.md):
 *  - DB row is canonical for SEND (we initiated it; we own the status).
 *  - Grid transfer is canonical for inbound (DB has no row for external incoming).
 *  - When the same signature appears in both lists, DB wins.
 *  - When a Grid transfer's `fromAddress` is the user's own gridAccountId,
 *    skip it from the inbound bucket — it's a self-send (DB already covers it
 *    as a SEND row, and Phase 7's receive-toast filter relies on this).
 *
 * Returns newest-first by timestamp.
 */
export function toUiTransactions(
  dto: TransactionsDto,
  myAddress: string,
): Transaction[] {
  const bySig = new Map<string, Transaction>();

  // DB rows first — canonical for SEND status / PENDING progression.
  for (const row of dto.transactions) {
    const tx = dbRowToTransaction(row);
    if (tx) bySig.set(tx.signature, tx);
  }

  // Grid transfers second — fill in inbound that the DB hasn't recorded.
  for (const t of dto.transfers) {
    // BridgeTransfer entries in the union have no `signature`; filter them out.
    if (!("signature" in t)) continue;
    const spl = t as GridTransferDto;
    if (bySig.has(spl.signature)) continue; // DB wins on collisions.
    if (spl.fromAddress === myAddress) continue; // Self-send already captured as SEND DB row.
    bySig.set(spl.signature, gridTransferToTransaction(spl, myAddress));
  }

  return Array.from(bySig.values()).sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

function dbRowToTransaction(row: TransactionRowDto): Transaction | null {
  // signature is .unique() but nullable in schema — a row without a signature
  // can't be matched to chain history, so skip it for the UI.
  if (!row.signature) return null;

  return {
    id: row.signature,
    signature: row.signature,
    type: row.type === "SEND" ? "sent" : "received",
    amount: row.amount,
    token: "USDC",
    status: row.status,
    timestamp: row.confirmedAt ?? row.createdAt,
    from: row.fromAddress,
    to: row.toAddress,
  };
}

function gridTransferToTransaction(
  t: GridTransferDto,
  myAddress: string,
): Transaction {
  // direction is optional; fall back to address comparison.
  const type =
    t.direction === "outflow" ||
    (t.direction === undefined && t.fromAddress === myAddress)
      ? "sent"
      : "received";

  // Grid's confirmation status is lowercase 'pending' | 'confirmed'.
  // Map to the uppercase UI status union; Grid never reports FAILED here
  // (failed sends don't show up in the transfer list at all).
  const status: TransactionStatus =
    t.confirmationStatus === "confirmed" ? "CONFIRMED" : "PENDING";

  return {
    id: t.signature,
    signature: t.signature,
    type,
    amount: t.uiAmount,
    token: "USDC",
    status,
    timestamp: t.confirmedAt ?? t.createdAt,
    from: t.fromAddress,
    to: t.toAddress,
  };
}

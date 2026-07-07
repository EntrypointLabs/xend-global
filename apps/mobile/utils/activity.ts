import type { TransferRow } from "@/utils/apiClient";

/**
 * Canonical, presentation-ready shape for a single transfer as the Activity
 * feed renders it. Intentionally free of React/React Native imports so the
 * mapping/grouping logic is unit-testable under plain jest.
 */
export interface ActivityEntry {
  id: string;
  direction: "send" | "receive";
  status: "pending" | "confirmed" | "failed";
  mint: string;
  amountRaw: string;
  decimals: number;
  self: string;
  counterparty: string;
  signature: string | null;
  memo: string | null;
  createdAt: string;
  confirmedAt: string | null;
}

export interface ActivitySection {
  title: string;
  data: ActivityEntry[];
}

export interface MapTransferContext {
  selfAddress: string;
  decimalsByMint: Record<string, number>;
}

const DEFAULT_DECIMALS = 6;

/**
 * Adapt a raw backend `TransferRow` into the canonical `ActivityEntry`.
 * The counterparty is the "other side" relative to the signed-in wallet:
 * the recipient for a SEND, the sender for a RECEIVE.
 */
export function mapTransferRowToActivityEntry(
  row: TransferRow,
  ctx: MapTransferContext
): ActivityEntry {
  const direction = row.direction === "SEND" ? "send" : "receive";
  const counterparty =
    row.direction === "SEND" ? row.toAddress : row.fromAddress;

  return {
    id: row.id,
    direction,
    status: row.status.toLowerCase() as ActivityEntry["status"],
    mint: row.mint,
    amountRaw: row.amountRaw,
    decimals: ctx.decimalsByMint[row.mint] ?? DEFAULT_DECIMALS,
    self: ctx.selfAddress,
    counterparty,
    signature: row.signature,
    memo: row.memo,
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
  };
}

// Newest-first, matching the backend's `createdAt desc, id desc`. ISO 8601
// timestamps share a fixed-width format, so lexical order is chronological.
function byNewestFirst(a: ActivityEntry, b: ActivityEntry): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
}

// UTC calendar day (`YYYY-MM-DD`) of an ISO 8601 timestamp.
function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Bucket entries into day sections for a `SectionList`. Sections are ordered
 * newest day first and each section's rows newest first — both sorted
 * explicitly rather than relying on input order.
 */
export function groupIntoSections(entries: ActivityEntry[]): ActivitySection[] {
  const buckets = new Map<string, ActivityEntry[]>();
  for (const entry of entries) {
    const key = dayKey(entry.createdAt);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(entry);
    else buckets.set(key, [entry]);
  }

  const sections: ActivitySection[] = [];
  for (const [title, data] of buckets) {
    data.sort(byNewestFirst);
    sections.push({ title, data });
  }
  sections.sort((a, b) => (a.title < b.title ? 1 : a.title > b.title ? -1 : 0));
  return sections;
}

/** Short human label for a row's status/direction. */
export function statusLabel(entry: ActivityEntry): string {
  if (entry.status === "pending") return "Sending…";
  if (entry.status === "failed") return "Failed";
  return entry.direction === "send" ? "Sent" : "Received";
}

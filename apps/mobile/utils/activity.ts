import type {
  AccountEventRow,
  AwaitingPayment,
  TransferRow,
} from "@/utils/apiClient";
import { describeToken, formatTokenAmount } from "@/utils/tokens";

/**
 * Canonical, presentation-ready shape for a single transfer as the Activity
 * feed renders it. Intentionally free of React/React Native imports so the
 * mapping/grouping logic is unit-testable under plain jest.
 */
export interface ActivityEntry {
  id: string;
  direction: "send" | "receive";
  status: "pending" | "confirmed" | "failed";
  // A plain send/receive, a settled merchant Payment, a non-money account
  // event, or a Payment still waiting on this phone. The first two are
  // lowercase matching the backend transfer_kind wire literal; "security" and
  // "awaiting" are client-side only, since CONTEXT.md defines Activity as
  // covering non-money events too.
  kind: "transfer" | "payment" | "security" | "awaiting";
  /** Set only on `security` entries: what changed on the Account. */
  securityLabel?: string;
  /**
   * Set only on `security` entries: which key or name it was.
   *
   * Its own field rather than folded into the label, because the row shows the
   * two on separate lines and the detail sheet leads with this one.
   */
  securitySubject?: string;
  /**
   * Set only on `security` entries: which kind it is.
   *
   * Carried rather than inferred from the label. Reading the wording to pick
   * an icon breaks the moment the wording changes, and it already did: a
   * renamed wallet was being drawn with a key.
   */
  securityKind?: AccountEventRow["kind"];
  merchantName: string | null;
  /**
   * Set only on `awaiting` entries: the Merchant's own currency and the figure
   * they quoted.
   *
   * Carried instead of the token amount because nothing has moved yet. There is
   * no settlement figure to render, and showing one would put a number on the
   * feed that no Payment has produced.
   */
  displayCurrency?: string;
  displayAmountMinor?: string;
  mint: string;
  amountRaw: string;
  decimals: number;
  self: string;
  counterparty: string;
  signature: string | null;
  /**
   * The token's logo, carried on the row rather than looked up from what the
   * Consumer holds now, so a sold-out token keeps its identity.
   */
  iconUrl?: string | null;
  /** What a Consumer calls the token: "Solana". */
  tokenName?: string | null;
  /** The ticker shown beside the amount. */
  tokenSymbol?: string | null;
  /**
   * What the transfer was worth in USD when it happened, as a decimal string.
   * Frozen at the time of the transfer, so it does not move with the market.
   */
  usdValue?: string | null;
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
  /**
   * Logos by mint from the balance read.
   *
   * A fallback only: rows carry their own logo now, because this map knows
   * nothing about a token the Consumer has sold.
   */
  iconsByMint?: Record<string, string>;
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
    kind: row.kind === "payment" ? "payment" : "transfer",
    merchantName: row.merchantName,
    mint: row.mint,
    amountRaw: row.amountRaw,
    // The row's own decimals first. The holdings lookup only knows mints the
    // Consumer still holds, so relying on it renders the history of anything
    // they have since sent away out by orders of magnitude.
    decimals: row.decimals ?? ctx.decimalsByMint[row.mint] ?? DEFAULT_DECIMALS,
    iconUrl: row.tokenIconUrl ?? ctx.iconsByMint?.[row.mint] ?? null,
    tokenName: row.tokenName ?? null,
    tokenSymbol: row.tokenSymbol ?? null,
    usdValue: row.usdValue ?? null,
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
  // A security event has no direction and no amount, so its label is the
  // change itself rather than a money verb.
  if (entry.kind === "security") {
    return entry.securityLabel ?? "Account updated";
  }
  if (entry.kind === "awaiting") {
    return "Needs your approval";
  }
  if (entry.kind === "payment") {
    if (entry.status === "pending") return "Paying…";
    if (entry.status === "failed") return "Failed";
    return "Paid";
  }
  if (entry.status === "pending") return "Sending…";
  if (entry.status === "failed") return "Failed";
  return entry.direction === "send" ? "Sent" : "Received";
}

/**
 * A non-money Account event, shaped as an Activity so it sits in the same feed.
 *
 * Adding a recovery key is the first of these: it changes who can reach the
 * Account, which is exactly the kind of thing a Consumer should be able to find
 * later, and burying it in settings would hide it.
 */
export function securityActivityEntry(params: {
  id: string;
  label: string;
  subject?: string;
  eventKind?: AccountEventRow["kind"];
  signature?: string | null;
  at: string;
  self: string;
}): ActivityEntry {
  return {
    id: params.id,
    direction: "receive",
    status: "confirmed",
    kind: "security",
    securityLabel: params.label,
    securitySubject: params.subject,
    securityKind: params.eventKind,
    merchantName: null,
    mint: "",
    amountRaw: "0",
    decimals: 0,
    self: params.self,
    counterparty: "",
    signature: params.signature ?? null,
    memo: null,
    createdAt: params.at,
    confirmedAt: params.at,
  };
}

/**
 * A Payment a checkout could not finish, shaped as an Activity so it sits in
 * the feed rather than only in a banner.
 *
 * Client-side only, and deliberately not a row the backend hands over: nothing
 * has happened on chain, so there is no transfer to read. It leaves the feed
 * the moment the Payment settles, and the settled Payment arrives as its own
 * entry, so one Payment is never two rows at rest.
 *
 * `pending` rather than a status of its own: it is the one the feed already
 * renders as inactive and unfinished, which is what this is.
 */
export function awaitingPaymentActivityEntry(
  payment: AwaitingPayment,
  selfAddress: string
): ActivityEntry {
  return {
    id: `awaiting:${payment.reference}`,
    direction: "send",
    status: "pending",
    kind: "awaiting",
    merchantName: payment.merchantDisplayName,
    displayCurrency: payment.displayCurrency,
    displayAmountMinor: payment.displayAmountMinor,
    mint: "",
    amountRaw: "0",
    decimals: 0,
    self: selfAddress,
    counterparty: "",
    signature: null,
    memo: null,
    // When the Consumer was asked, not when this was rendered. A timestamp
    // computed here would move on every render and drift between the row's
    // sort position and the day it is filed under.
    createdAt: payment.deferredAt,
    confirmedAt: null,
  };
}

/**
 * What an arrival toast says: the amount and the asset, in the Consumer's
 * terms.
 *
 * Deliberately not the dollar value. "Received 5 SOL" is what happened; the
 * dollars are a rendering of it, and the activity row already carries them.
 */
export function arrivalLabel(row: TransferRow): string {
  const { symbol } = describeToken(row.mint, row.tokenSymbol, row.tokenName);
  const decimals = row.decimals ?? DEFAULT_DECIMALS;
  const amount = formatTokenAmount(
    Number(row.amountRaw) / 10 ** decimals,
    decimals
  );
  return symbol ? `Received ${amount} ${symbol}` : `Received ${amount}`;
}

/**
 * How an account event reads in the feed.
 *
 * Written out per kind rather than assembled from the kind and the subject,
 * because these are the sentences a Consumer will scan when they are trying to
 * work out whether something happened to their account without them.
 */
function describeEvent(event: AccountEventRow): {
  label: string;
  subject?: string;
} {
  const subject = event.subject ?? undefined;
  switch (event.kind) {
    case "recovery_key_added":
      return { label: "Added Recovery Key", subject };
    case "recovery_key_removed":
      return { label: "Removed Recovery Key", subject };
    case "wallet_renamed":
      return {
        label: event.previousSubject ? "Renamed Wallet" : "Named Wallet",
        subject,
      };
  }
}

/**
 * Turns an account event into a feed entry.
 *
 * Ids are prefixed because the list keys on `id` alone and these come from a
 * different table than the transfers beside them.
 */
export function mapAccountEventToActivityEntry(
  event: AccountEventRow,
  selfAddress: string
): ActivityEntry {
  const { label, subject } = describeEvent(event);
  return securityActivityEntry({
    id: `event:${event.id}`,
    label,
    subject,
    eventKind: event.kind,
    signature: event.signature,
    at: event.occurredAt,
    self: selfAddress,
  });
}

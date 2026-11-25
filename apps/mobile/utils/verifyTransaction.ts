import {
  associatedTokenAddress,
  deriveProposalAddress,
  describeTransaction,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type PolicyTerms,
  type SettingsChangeAction,
  type TransactionDescription,
  type Vote,
} from "@prydd/smart-account";
import { PublicKey } from "@solana/web3.js";

/**
 * What the backend built has to match what the Consumer was shown. The Account
 * needs two signatures to move money, and both of them are asked for on this
 * phone, so a backend that returned a different transaction would be signed
 * without either of them ever disagreeing. Reading the message back is the only
 * thing standing between the Consumer and a payload they never saw.
 */
export class TransactionMismatchError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`the request did not match what was shown: ${reason}`);
    this.name = "TransactionMismatchError";
    this.reason = reason;
  }
}

export interface ExpectedSpend {
  /** The Account the money leaves. */
  vault: string;
  destination: string;
  mint: string;
  /** In the mint's smallest units, as the amount the Consumer confirmed. */
  amountRaw: string;
}

/**
 * A Merchant Payment: exactly the amount on the card, in that currency, out of
 * this Account, into the USDC account of the wallet the store publishes on its
 * own site, and nothing else.
 */
export interface ExpectedPayment {
  vault: string;
  mint: string;
  amountRaw: string;
  payoutWallet: string;
}

/** The Account's two phone-held keys, as they stand once a change lands. */
export interface AccountSigners {
  primary: string;
  approval: string;
}

/**
 * The actions a settings change is allowed to carry. Anything the message
 * holds beyond this is a mismatch, which is what keeps a rotation from also
 * quietly moving a signer nobody named.
 */
export interface ExpectedSettings {
  vault: string;
  /**
   * The only keys a spending rule may name, and the keys an unnamed removal
   * may not take. A rule that named any other key, the recovery key included,
   * would let that key spend.
   */
  signers: AccountSigners;
  /** The permission mask a key this change adds must carry. Required to add one. */
  addSignerPermissions?: number;
  /**
   * The proposal this step belongs to. When given, a proposal or a vote for
   * any other index is refused, which is what stops an approval meant for one
   * change from landing on another.
   */
  transactionIndex?: string;
  /** The keys this change may add, when the caller knows them by name. */
  addSigners?: string[];
  /** The keys this change may remove, when the caller knows them by name. */
  removeSigners?: string[];
  /**
   * How many additions to allow when the step does not name the key, as
   * adding a recovery key does not. Ignored when `addSigners` is given.
   */
  maxAddSigners?: number;
  maxRemoveSigners?: number;
  setTimeLockSeconds?: number;
  /** How many policies the change may create, as setting an Account up creates two. */
  policyCreates?: number;
  /** How many rules the change may rewrite, as moving a signer rewrites the rules naming it. */
  policyUpdates?: number;
  /**
   * How many rules the change may take away, as removing the spending limit
   * takes away the rule that carries it. Zero unless the caller asks for it,
   * because a rule removed is a rule that stops holding anything back.
   */
  policyRemovals?: number;
  changeThreshold?: number;
}

interface Budget {
  policyCreates: number;
  policyUpdates: number;
  policyRemovals: number;
  addSigners: number;
  removeSigners: number;
}

function describe(base64: string, vault: string): TransactionDescription {
  return describeTransaction(base64, {
    addresses: { vault: new PublicKey(vault) },
  });
}

function sameKey(a: PublicKey | null, b: string): boolean {
  return a !== null && a.toBase58() === b;
}

/**
 * Returns the reason a prepared Spend does not match, or null when it does.
 * Pure, so the call sites can report and refuse in whatever way suits them.
 */
export function checkSpend(
  base64: string,
  expected: ExpectedSpend
): string | null {
  let description: TransactionDescription;
  try {
    description = describe(base64, expected.vault);
  } catch (err) {
    return `it could not be read (${(err as Error).message})`;
  }

  if (description.kind !== "spend") {
    return description.kind === "unknown"
      ? `it is not a payment (${description.reason})`
      : `it is not a payment (${description.kind})`;
  }
  if (description.vault.toBase58() !== expected.vault) {
    return "it moves money out of another account";
  }
  const paid = description.destination ?? description.destinationTokenAccount;
  if (!sameKey(paid, expected.destination)) {
    return "it pays someone else";
  }
  const mint = description.mint === "SOL" ? "SOL" : description.mint.toBase58();
  if (mint !== expected.mint) {
    return "it sends a different currency";
  }
  if (description.amount !== BigInt(expected.amountRaw)) {
    return "it sends a different amount";
  }
  return null;
}

/**
 * The two rule shapes an Account carries: the Spending Limit, drawn on by the
 * passkey alone, and the above-limit rule, which needs both phone keys. A
 * rule of any other shape, or naming any other key, would let something other
 * than this phone move money.
 */
/**
 * Returns the reason a prepared Merchant Payment does not match, or null when
 * it does.
 */
export function checkPayment(
  base64: string,
  expected: ExpectedPayment
): string | null {
  let description: TransactionDescription;
  try {
    description = describe(base64, expected.vault);
  } catch (err) {
    return `it could not be read (${(err as Error).message})`;
  }
  if (description.kind !== "spend") {
    return description.kind === "unknown"
      ? `it is not a payment (${description.reason})`
      : `it is not a payment (${description.kind})`;
  }
  if (description.vault.toBase58() !== expected.vault) {
    return "it moves money out of another account";
  }
  const mint = description.mint === "SOL" ? "SOL" : description.mint.toBase58();
  if (mint !== expected.mint) {
    return "it sends a different currency";
  }
  if (description.amount !== BigInt(expected.amountRaw)) {
    return "it sends a different amount";
  }
  if (
    description.destination &&
    description.destination.toBase58() !== expected.payoutWallet
  ) {
    return "it pays someone other than the store";
  }
  const storeAccount = associatedTokenAddress(
    new PublicKey(expected.payoutWallet),
    description.mint as PublicKey,
    TOKEN_PROGRAM_ID
  );
  if (!description.destinationTokenAccount?.equals(storeAccount)) {
    return "it pays someone other than the store";
  }
  return null;
}

export interface ExpectedTransfer {
  /** The ordinary key the money leaves. */
  source: string;
  /** Who is paid. A token transfer may name only their associated account. */
  destination: string;
  mint: string;
  amountRaw: string;
}

/**
 * Returns the reason a prepared plain transfer, signed by an ordinary key
 * outside the Account, does not match, or null when it does.
 */
export function checkTransfer(
  base64: string,
  expected: ExpectedTransfer
): string | null {
  let description: TransactionDescription;
  try {
    description = describe(base64, expected.destination);
  } catch (err) {
    return `it could not be read (${(err as Error).message})`;
  }
  if (description.kind !== "transfer") {
    return description.kind === "unknown"
      ? `it is not a transfer (${description.reason})`
      : `it is not a transfer (${description.kind})`;
  }
  if (description.source.toBase58() !== expected.source) {
    return "it moves money out of another wallet";
  }
  const mint = description.mint === "SOL" ? "SOL" : description.mint.toBase58();
  if (mint !== expected.mint) {
    return "it sends a different currency";
  }
  if (description.amount !== BigInt(expected.amountRaw)) {
    return "it sends a different amount";
  }
  if (description.destination) {
    return description.destination.toBase58() === expected.destination
      ? null
      : "it pays someone else";
  }
  if (description.mint === "SOL" || !description.destinationTokenAccount) {
    return "it pays someone else";
  }
  const owner = new PublicKey(expected.destination);
  const paysOwner = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].some((program) =>
    associatedTokenAddress(
      owner,
      description.mint as PublicKey,
      program
    ).equals(description.destinationTokenAccount!)
  );
  return paysOwner ? null : "it pays someone else";
}

/**
 * Returns the reason a prepared rejection does not match, or null when it
 * does. It must only vote no, and only on the change the Consumer was shown.
 */
export function checkRejection(
  base64: string,
  expected: { vault: string; transactionIndex: string }
): string | null {
  let description: TransactionDescription;
  try {
    description = describe(base64, expected.vault);
  } catch (err) {
    return `it could not be read (${(err as Error).message})`;
  }
  if (description.kind !== "vote") {
    return description.kind === "unknown"
      ? `it is not a rejection (${description.reason})`
      : `it is not a rejection (${description.kind})`;
  }
  if (description.vault.toBase58() !== expected.vault) {
    return "it votes on another account";
  }
  if (!description.votes.every((v: Vote) => v.kind === "reject")) {
    return "it does more than reject the change";
  }
  return votesFor(
    description.proposal.toBase58(),
    description.settings.toBase58(),
    expected
  );
}

function termsAllowed(
  terms: PolicyTerms,
  signers: AccountSigners
): string | null {
  const named = terms.signers.map((s) => s.toBase58());
  switch (terms.kind) {
    case "spending-limit":
      return named.length === 1 &&
        named[0] === signers.primary &&
        terms.threshold === 1
        ? null
        : "it lets a key other than your passkey spend under the limit";
    case "program-interaction": {
      const both =
        named.length === 2 &&
        named.includes(signers.primary) &&
        named.includes(signers.approval);
      return both && terms.threshold === 2
        ? null
        : "it lets a payment above the limit go through without both keys";
    }
    default:
      return "it sets up a kind of spending rule this app does not use";
  }
}

function votesFor(
  proposal: string,
  settings: string,
  expected: { transactionIndex?: string }
): string | null {
  if (expected.transactionIndex === undefined) return null;
  const pinned = deriveProposalAddress(
    new PublicKey(settings),
    BigInt(expected.transactionIndex)
  ).toBase58();
  return proposal === pinned ? null : "it approves a different change";
}

function actionAllowed(
  action: SettingsChangeAction,
  expected: ExpectedSettings,
  budget: Budget
): string | null {
  switch (action.kind) {
    case "add-signer": {
      if (
        expected.addSignerPermissions === undefined ||
        action.permissions !== expected.addSignerPermissions
      ) {
        return "it gives a new key more power than this change allows";
      }
      if (expected.addSigners) {
        return expected.addSigners.includes(action.key.toBase58())
          ? null
          : "it adds a key that was not part of this change";
      }
      if (budget.addSigners <= 0) {
        return "it adds a key that was not part of this change";
      }
      budget.addSigners -= 1;
      return null;
    }
    case "remove-signer": {
      if (expected.removeSigners) {
        return expected.removeSigners.includes(action.key.toBase58())
          ? null
          : "it removes a key that was not part of this change";
      }
      if (budget.removeSigners <= 0) {
        return "it removes a key that was not part of this change";
      }
      const removed = action.key.toBase58();
      if (
        removed === expected.signers.primary ||
        removed === expected.signers.approval
      ) {
        return "it removes a key this phone holds";
      }
      budget.removeSigners -= 1;
      return null;
    }
    case "set-time-lock":
      return action.seconds === expected.setTimeLockSeconds
        ? null
        : "it changes how long a change waits";
    case "change-threshold":
      return action.threshold === expected.changeThreshold
        ? null
        : "it changes how many approvals are needed";
    case "policy-create": {
      if (budget.policyCreates <= 0) {
        return "it sets up a spending rule that was not part of this change";
      }
      const terms = termsAllowed(action.terms, expected.signers);
      if (terms) return terms;
      budget.policyCreates -= 1;
      return null;
    }
    case "policy-update": {
      // Moving a signer rewrites the rules that name it, because an update
      // replaces the whole policy. What must not survive is the key the change
      // is retiring: a rule that still names it would leave the old phone able
      // to approve.
      if (budget.policyUpdates <= 0) {
        return "it rewrites a spending rule that was not part of this change";
      }
      const signers = action.terms.signers.map((s) => s.toBase58());
      const retained = (expected.removeSigners ?? []).find((key) =>
        signers.includes(key)
      );
      if (retained) {
        return "it leaves the retired key on a spending rule";
      }
      const terms = termsAllowed(action.terms, expected.signers);
      if (terms) return terms;
      budget.policyUpdates -= 1;
      return null;
    }
    case "policy-remove":
      if (budget.policyRemovals <= 0) {
        return "it takes away a spending rule that was not part of this change";
      }
      budget.policyRemovals -= 1;
      return null;
    default:
      return "it carries a change that was not part of this request";
  }
}

/**
 * Returns the reason a prepared settings change does not match, or null when
 * it does. Every action in the message must be one the caller named.
 */
export function checkSettings(
  base64: string,
  expected: ExpectedSettings
): string | null {
  let description: TransactionDescription;
  try {
    description = describe(base64, expected.vault);
  } catch (err) {
    return `it could not be read (${(err as Error).message})`;
  }

  // A later step of a change staged earlier carries votes and no actions.
  if (description.kind === "vote") {
    if (description.vault.toBase58() !== expected.vault) {
      return "it approves a change on another account";
    }
    return votesFor(
      description.proposal.toBase58(),
      description.settings.toBase58(),
      expected
    );
  }
  if (description.kind !== "settings") {
    return description.kind === "unknown"
      ? `it is not a settings change (${description.reason})`
      : `it is not a settings change (${description.kind})`;
  }
  if (description.vault.toBase58() !== expected.vault) {
    return "it changes another account";
  }
  if (
    expected.transactionIndex !== undefined &&
    description.transactionIndex !== BigInt(expected.transactionIndex)
  ) {
    return "it is a different change";
  }

  const budget: Budget = {
    policyCreates: expected.policyCreates ?? 0,
    policyUpdates: expected.policyUpdates ?? 0,
    policyRemovals: expected.policyRemovals ?? 0,
    addSigners: expected.maxAddSigners ?? 0,
    removeSigners: expected.maxRemoveSigners ?? 0,
  };
  for (const action of description.actions) {
    const reason = actionAllowed(action, expected, budget);
    if (reason) return reason;
  }

  if (expected.addSigners) {
    const added = description.actions.filter((a) => a.kind === "add-signer");
    if (added.length !== expected.addSigners.length) {
      return "it does not add the key this change is for";
    }
  }
  if (expected.removeSigners) {
    const removed = description.actions.filter(
      (a) => a.kind === "remove-signer"
    );
    if (removed.length !== expected.removeSigners.length) {
      return "it does not remove the key this change is for";
    }
  }
  if (
    expected.setTimeLockSeconds !== undefined &&
    !description.actions.some((a) => a.kind === "set-time-lock")
  ) {
    return "it does not set the waiting period this change is for";
  }
  if (budget.policyCreates !== 0) {
    return "it does not set up the spending rules this change is for";
  }
  if (budget.policyRemovals !== 0) {
    return "it does not take away the spending rule this change is for";
  }
  return null;
}

export function assertSpend(base64: string, expected: ExpectedSpend): void {
  const reason = checkSpend(base64, expected);
  if (reason) throw new TransactionMismatchError(reason);
}

export function assertPayment(base64: string, expected: ExpectedPayment): void {
  const reason = checkPayment(base64, expected);
  if (reason) throw new TransactionMismatchError(reason);
}

export function assertTransfer(
  base64: string,
  expected: ExpectedTransfer
): void {
  const reason = checkTransfer(base64, expected);
  if (reason) throw new TransactionMismatchError(reason);
}

export function assertRejection(
  base64: string,
  expected: { vault: string; transactionIndex: string }
): void {
  const reason = checkRejection(base64, expected);
  if (reason) throw new TransactionMismatchError(reason);
}

export function assertSettings(
  base64: string,
  expected: ExpectedSettings
): void {
  const reason = checkSettings(base64, expected);
  if (reason) throw new TransactionMismatchError(reason);
}

/** What a Consumer is told when a prepared request does not match. */
export const MISMATCH_MESSAGE =
  "This request did not match what you approved, so nothing was sent. Try again, and tell us if it keeps happening.";

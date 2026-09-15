import {
  describeTransaction,
  type SettingsChangeAction,
  type TransactionDescription,
} from "@xend/smart-account";
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
 * The actions a settings change is allowed to carry. Anything the message
 * holds beyond this is a mismatch, which is what keeps a rotation from also
 * quietly moving a signer nobody named.
 */
export interface ExpectedSettings {
  vault: string;
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

function actionAllowed(
  action: SettingsChangeAction,
  expected: ExpectedSettings,
  budget: Budget
): string | null {
  switch (action.kind) {
    case "add-signer": {
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
    case "policy-create":
      if (budget.policyCreates <= 0) {
        return "it sets up a spending rule that was not part of this change";
      }
      budget.policyCreates -= 1;
      return null;
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
    return description.vault.toBase58() === expected.vault
      ? null
      : "it approves a change on another account";
  }
  if (description.kind !== "settings") {
    return description.kind === "unknown"
      ? `it is not a settings change (${description.reason})`
      : `it is not a settings change (${description.kind})`;
  }
  if (description.vault.toBase58() !== expected.vault) {
    return "it changes another account";
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

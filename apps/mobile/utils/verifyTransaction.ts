import {
  ABOVE_LIMIT_PROGRAM_ALLOWLIST,
  derivePolicyAddress,
  describeTransaction,
  type SettingsChangeAction,
  type StagedSettingsChange,
  type TransactionDescription,
} from "@prydd/smart-account";
import { type AddressLookupTableAccount, PublicKey } from "@solana/web3.js";

import { WRAPPED_SOL_MINT } from "@/utils/swap";

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

function describe(
  base64: string,
  vault: string,
  lookupTables?: readonly AddressLookupTableAccount[]
): TransactionDescription {
  return describeTransaction(base64, {
    addresses: { vault: new PublicKey(vault) },
    lookupTables,
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

export interface ExpectedSwap {
  /** The Account both sides of the swap belong to. */
  vault: string;
  /** The two keys that have to sign. A swap naming any other is not this Account's. */
  signers: string[];
  /** Mints as the quote named them, with native SOL as its wrapped mint. */
  inputMint: string;
  outputMint: string;
  amountInRaw: string;
  /** The price on screen, and how far short of it the swap may settle. */
  quotedAmountOutRaw: string;
  slippageBps: number;
  /**
   * Whether the vault already has a wrapped SOL account, as this phone read
   * it from the chain. A swap may hand the fee payer back the rent for that
   * account only when the fee payer is the one opening it.
   */
  wrappedSolAccountExists: boolean;
}

/**
 * Returns the reason a prepared swap does not match, or null when it does.
 *
 * The Account's policy lets its two keys run any route through the swap
 * program, so nothing on chain holds a swap to the price the Consumer saw.
 * This does: the pair, the amount paid, the price and the floor under it all
 * have to be the ones quoted.
 *
 * `lookupTables` are the tables the message names, read by this phone. A
 * route spans more accounts than a message can list inline.
 */
export function checkSwap(
  base64: string,
  expected: ExpectedSwap,
  lookupTables: readonly AddressLookupTableAccount[]
): string | null {
  let description: TransactionDescription;
  try {
    description = describe(base64, expected.vault, lookupTables);
  } catch (err) {
    return `it could not be read (${(err as Error).message})`;
  }

  if (description.kind !== "swap") {
    return description.kind === "unknown"
      ? `it is not a swap (${description.reason})`
      : `it is not a swap (${description.kind})`;
  }
  if (description.vault.toBase58() !== expected.vault) {
    return "it swaps out of another account";
  }
  const signers = description.signers.map((signer) => signer.toBase58());
  if (
    signers.length !== expected.signers.length ||
    !expected.signers.every((signer) => signers.includes(signer))
  ) {
    return "it is signed for by keys that are not this account's";
  }
  const named = (mint: PublicKey | "SOL") =>
    mint === "SOL" ? WRAPPED_SOL_MINT : mint.toBase58();
  // A swap that left the output wrapped would also name the wrapped mint, so
  // SOL is only SOL when the swap itself says it unwraps it.
  const isNative = (mint: string) => mint === WRAPPED_SOL_MINT;
  if (
    named(description.inputMint) !== expected.inputMint ||
    (description.inputMint === "SOL") !== isNative(expected.inputMint)
  ) {
    return "it pays with a different currency";
  }
  if (
    named(description.outputMint) !== expected.outputMint ||
    (description.outputMint === "SOL") !== isNative(expected.outputMint)
  ) {
    return "it buys a different currency";
  }
  if (description.amountIn !== BigInt(expected.amountInRaw)) {
    return "it pays a different amount";
  }
  if (description.quotedAmountOut !== BigInt(expected.quotedAmountOutRaw)) {
    return "it is priced differently";
  }
  if (description.slippageBps !== expected.slippageBps) {
    return "it allows a different shortfall";
  }
  if (description.refundsRent && expected.wrappedSolAccountExists) {
    return "it takes back rent this account already paid";
  }
  return null;
}

export interface ExpectedSwapAccess {
  vault: string;
  /** The Account's two spending keys, which the rule must go on naming. */
  primary: string;
  approval: string;
}

/**
 * Returns the reason a step of turning Swap on does not match, or null when it
 * does.
 *
 * The change rewrites the rule that governs every Spend above the limit, so
 * it is held to the one rewrite Swap needs and nothing looser: the same two
 * keys, both still required, no delay added, and exactly the programs this
 * build of the app knows. A rule naming a third key or one more program would
 * be a way into the Account that only shows a day later.
 */
export function checkSwapAccess(
  base64: string,
  expected: ExpectedSwapAccess,
  staged: StagedSettingsChange | null = null
): string | null {
  let description: TransactionDescription;
  try {
    description = describe(base64, expected.vault);
  } catch (err) {
    return `it could not be read (${(err as Error).message})`;
  }

  const keys = [expected.primary, expected.approval];
  // The steps after staging carry an approval or the execute and no actions,
  // so what they act on is not in the message. It is held to the same rewrite
  // as read from the chain: any other change waiting on this Account could
  // otherwise be passed off as the next step of turning Swap on.
  if (description.kind === "vote") {
    if (description.vault.toBase58() !== expected.vault) {
      return "it approves a change on another account";
    }
    if (
      !description.votes.every(
        (vote) =>
          vote.kind !== "reject" && keys.includes(vote.signer.toBase58())
      )
    ) {
      return "it carries a vote that is not this account's";
    }
    if (!staged || !staged.proposal.equals(description.proposal)) {
      return "the change it approves could not be read";
    }
    return swapRewriteMismatch(staged.actions, keys, description.settings);
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
    !description.votes.every(
      (vote) => vote.kind === "approve" && keys.includes(vote.signer.toBase58())
    )
  ) {
    return "it carries a vote that is not this account's";
  }
  return swapRewriteMismatch(description.actions, keys, description.settings);
}

/**
 * The proposal a transaction votes on or executes without saying what it
 * does, or null when the transaction carries its own actions.
 */
export function proposalVotedOn(
  base64: string,
  vault: string
): { settings: PublicKey; proposal: PublicKey } | null {
  try {
    const description = describe(base64, vault);
    return description.kind === "vote"
      ? { settings: description.settings, proposal: description.proposal }
      : null;
  } catch {
    return null;
  }
}

/**
 * Where every Account keeps the rule for Spends above its limit. Fixed when
 * the Account is created, so it is derived here and not taken from anyone.
 */
const ABOVE_LIMIT_POLICY_SEED = 2n;

/** Why `actions` are not the one rewrite Swap needs, or null when they are. */
function swapRewriteMismatch(
  actions: readonly SettingsChangeAction[],
  keys: readonly string[],
  settings: PublicKey
): string | null {
  const [action, ...others] = actions;
  if (!action || others.length > 0 || action.kind !== "policy-update") {
    return "it changes more than the spending rule Swap needs";
  }
  // An update replaces the whole policy it names. The same terms written
  // over the Spending Limit would pass every check below and leave the
  // Account unable to make an ordinary payment.
  const aboveLimit = derivePolicyAddress(settings, ABOVE_LIMIT_POLICY_SEED);
  if (!action.policy.equals(aboveLimit)) {
    return "it rewrites a different spending rule";
  }
  const { terms } = action;
  if (terms.kind !== "program-interaction" || !terms.programOnly) {
    return "it rewrites a different kind of spending rule";
  }
  // The rule this replaces never lapses. One that did would switch off
  // every payment above the limit when its time came, not only Swap.
  if (terms.expires) {
    return "it makes the spending rule expire";
  }
  const signers = terms.signers.map((signer) => signer.toBase58());
  if (
    signers.length !== 2 ||
    !keys.every((key) => signers.includes(key)) ||
    terms.threshold !== 2 ||
    terms.timeLock !== 0
  ) {
    return "it changes who can approve a payment";
  }
  const programs = terms.allowedPrograms.map((program) => program.toBase58());
  const known = ABOVE_LIMIT_PROGRAM_ALLOWLIST.map((program) =>
    program.toBase58()
  );
  if (
    programs.length !== known.length ||
    !programs.every((program, i) => program === known[i])
  ) {
    return "it allows programs this app does not know";
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

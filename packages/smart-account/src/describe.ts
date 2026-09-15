import {
  AddressLookupTableAccount,
  MessageAccountKeys,
  MessageV0,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  generated,
  getPolicyPda,
  getProposalPda,
  getSmartAccountPda,
  getTransactionPda,
  PROGRAM_ID,
} from "@sqds/smart-account";

import type { LimitPeriod } from "./policy.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  COMPUTE_BUDGET_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "./programs.js";
import { associatedTokenAddress } from "./spend.js";

const PRIMARY_ACCOUNT_INDEX = 0;
const NATIVE_MINT = PublicKey.default;

const SYSTEM_TRANSFER = 2;
const TOKEN_TRANSFER_CHECKED = 12;
const COMPUTE_BUDGET_HARMLESS = new Set([1, 2, 3, 4]);

/**
 * What a transaction handed to a signer would do, read off its bytes.
 *
 * A signer that trusts the server that built the message is a signer the
 * server can spend with. This is the other half of the check: every
 * instruction in the message is decoded, and anything not accounted for makes
 * the whole description `unknown`, which a caller must refuse to sign.
 */
export type TransactionDescription =
  | SpendDescription
  | SettingsChangeDescription
  | VoteDescription
  | TransferDescription
  | UnknownDescription;

export type DescribedSpendRoute = "spending-limit" | "above-limit" | "settings";

export interface SpendDescription {
  kind: "spend";
  /** The account the money leaves. */
  vault: PublicKey;
  /** The policy, or the Settings, the Spend executes under. */
  consensus: PublicKey;
  route: DescribedSpendRoute;
  /** The keys the program is asked to count toward the route's threshold. */
  signers: PublicKey[];
  /** Who is paid, when the message names them. Null when only a token account is named. */
  destination: PublicKey | null;
  destinationTokenAccount: PublicKey | null;
  mint: PublicKey | "SOL";
  /** In the mint's smallest units. */
  amount: bigint;
  /** Null for native SOL under the spending-limit route, which carries no decimals. */
  decimals: number | null;
  /** The message also opens the destination's associated token account. */
  opensDestinationTokenAccount: boolean;
}

export interface SettingsChangeDescription {
  kind: "settings";
  settings: PublicKey;
  /** Derived from `settings`, and equal to the vault the context named. */
  vault: PublicKey;
  transactionIndex: bigint;
  proposer: PublicKey;
  actions: SettingsChangeAction[];
  /** Votes riding in the same message, as provisioning does at lock zero. */
  votes: Vote[];
}

/** Approvals, rejections or an execute for a change proposed earlier. */
export interface VoteDescription {
  kind: "vote";
  settings: PublicKey;
  vault: PublicKey;
  proposal: PublicKey;
  votes: Vote[];
}

/** A plain transfer signed by an ordinary key, outside any Account. */
export interface TransferDescription {
  kind: "transfer";
  /** The key that authorises the transfer. */
  source: PublicKey;
  destination: PublicKey | null;
  destinationTokenAccount: PublicKey | null;
  mint: PublicKey | "SOL";
  amount: bigint;
  opensDestinationTokenAccount: boolean;
}

export interface UnknownDescription {
  kind: "unknown";
  reason: string;
}

export interface Vote {
  kind: "approve" | "reject" | "execute";
  signer: PublicKey;
}

export type SettingsChangeAction =
  | { kind: "add-signer"; key: PublicKey; permissions: number }
  | { kind: "remove-signer"; key: PublicKey }
  | { kind: "set-time-lock"; seconds: number }
  | { kind: "change-threshold"; threshold: number }
  | {
      kind: "policy-create";
      policy: PublicKey;
      seed: bigint;
      terms: PolicyTerms;
      summary: string;
    }
  | {
      kind: "policy-update";
      policy: PublicKey;
      terms: PolicyTerms;
      summary: string;
    }
  | { kind: "policy-remove"; policy: PublicKey }
  | { kind: "other"; name: string };

export type PolicyTerms =
  | {
      kind: "spending-limit";
      mint: PublicKey | "SOL";
      maxPerUse: bigint;
      maxPerPeriod: bigint;
      period: LimitPeriod | "Custom";
      destinations: PublicKey[];
      signers: PublicKey[];
      threshold: number;
      timeLock: number;
    }
  | {
      kind: "program-interaction";
      allowedPrograms: PublicKey[];
      /** False when a constraint carries account or data rules beyond the program id. */
      programOnly: boolean;
      signers: PublicKey[];
      threshold: number;
      timeLock: number;
    }
  | {
      kind: "other";
      name: string;
      signers: PublicKey[];
      threshold: number;
      timeLock: number;
    };

export interface DescribeContext {
  addresses: {
    /** The Account. Every Squads instruction must belong to it. */
    vault: PublicKey;
    /** When known. Otherwise it is read off the message and checked against `vault`. */
    settings?: PublicKey;
  };
  /** Names the route by address rather than by payload kind, when known. */
  spendingLimitPolicy?: PublicKey;
  aboveLimitPolicy?: PublicKey;
  /** Required for any message that uses address lookup tables. */
  lookupTables?: readonly AddressLookupTableAccount[];
}

export function deriveVaultAddress(settings: PublicKey): PublicKey {
  return getSmartAccountPda({
    settingsPda: settings,
    accountIndex: PRIMARY_ACCOUNT_INDEX,
  })[0];
}

export function describeTransaction(
  base64: string,
  context: DescribeContext,
): TransactionDescription {
  try {
    return describe(base64, context);
  } catch (cause) {
    return unknown(
      `could not decode the message: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

function describe(
  base64: string,
  context: DescribeContext,
): TransactionDescription {
  const tx = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
  const message = tx.message;
  if (!(message instanceof MessageV0)) {
    return unknown("not a v0 message");
  }

  let keys: MessageAccountKeys;
  if (message.addressTableLookups.length === 0) {
    keys = message.getAccountKeys();
  } else {
    if (!context.lookupTables?.length) {
      return unknown("uses address lookup tables that were not resolved");
    }
    keys = message.getAccountKeys({
      addressLookupTableAccounts: [...context.lookupTables],
    });
  }

  const decoded: Decoded[] = [];
  for (const ix of message.compiledInstructions) {
    const programId = keys.get(ix.programIdIndex);
    if (!programId)
      return unknown("instruction names a program off the message");
    const accounts: PublicKey[] = [];
    for (const index of ix.accountKeyIndexes) {
      const key = keys.get(index);
      if (!key) return unknown("instruction names an account off the message");
      accounts.push(key);
    }
    const result = decodeInstruction(programId, accounts, Buffer.from(ix.data));
    if (result.kind === "unknown") return result;
    decoded.push(result);
  }

  return assemble(decoded, context);
}

type Decoded =
  | { kind: "spend"; spend: SpendDescription }
  | {
      kind: "propose";
      settings: PublicKey;
      transaction: PublicKey;
      proposer: PublicKey;
      actions: generated.SettingsAction[];
    }
  | {
      kind: "create-proposal";
      consensus: PublicKey;
      proposal: PublicKey;
      transactionIndex: bigint;
    }
  | { kind: "vote"; consensus: PublicKey; proposal: PublicKey; vote: Vote }
  | { kind: "transfer"; transfer: TransferDescription }
  | {
      kind: "open-token-account";
      ata: PublicKey;
      owner: PublicKey;
      mint: PublicKey;
    }
  | { kind: "compute-budget" }
  | UnknownDescription;

function decodeInstruction(
  programId: PublicKey,
  accounts: PublicKey[],
  data: Buffer,
): Decoded {
  if (programId.equals(PROGRAM_ID)) return decodeSquads(accounts, data);
  if (programId.equals(SYSTEM_PROGRAM_ID)) return decodeSystem(accounts, data);
  if (
    programId.equals(TOKEN_PROGRAM_ID) ||
    programId.equals(TOKEN_2022_PROGRAM_ID)
  ) {
    return decodeToken(accounts, data);
  }
  if (programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
    return decodeAssociatedToken(accounts, data);
  }
  if (programId.equals(COMPUTE_BUDGET_PROGRAM_ID)) {
    return COMPUTE_BUDGET_HARMLESS.has(data[0] ?? -1)
      ? { kind: "compute-budget" }
      : unknown("unrecognised compute budget instruction");
  }
  return unknown(
    `instruction to ${programId.toBase58()}, which is not a program a signer expects`,
  );
}

function decodeSquads(accounts: PublicKey[], data: Buffer): Decoded {
  const discriminator = [...data.subarray(0, 8)];
  const is = (expected: number[]) =>
    expected.length === 8 &&
    expected.every((byte, i) => byte === discriminator[i]);

  if (is(generated.createSettingsTransactionInstructionDiscriminator)) {
    const [settings, transaction, proposer] = accounts;
    if (!settings || !transaction || !proposer)
      return unknown("malformed settings change");
    const [{ args }] =
      generated.createSettingsTransactionStruct.deserialize(data);
    return {
      kind: "propose",
      settings,
      transaction,
      proposer,
      actions: args.actions,
    };
  }
  if (is(generated.createProposalInstructionDiscriminator)) {
    const [consensus, proposal] = accounts;
    if (!consensus || !proposal) return unknown("malformed proposal");
    const [{ args }] = generated.createProposalStruct.deserialize(data);
    return {
      kind: "create-proposal",
      consensus,
      proposal,
      transactionIndex: toBigInt(args.transactionIndex),
    };
  }
  if (is(generated.approveProposalInstructionDiscriminator)) {
    return vote("approve", accounts);
  }
  if (is(generated.rejectProposalInstructionDiscriminator)) {
    return vote("reject", accounts);
  }
  if (is(generated.executeSettingsTransactionInstructionDiscriminator)) {
    const [settings, signer, proposal] = accounts;
    if (!settings || !signer || !proposal) return unknown("malformed execute");
    return {
      kind: "vote",
      consensus: settings,
      proposal,
      vote: { kind: "execute", signer },
    };
  }
  if (is(generated.executeTransactionSyncV2InstructionDiscriminator)) {
    return decodeSyncSpend(accounts, data);
  }
  return unknown("unrecognised Squads instruction");
}

function vote(kind: "approve" | "reject", accounts: PublicKey[]): Decoded {
  const [consensus, signer, proposal] = accounts;
  if (!consensus || !signer || !proposal) return unknown(`malformed ${kind}`);
  return { kind: "vote", consensus, proposal, vote: { kind, signer } };
}

function decodeSyncSpend(accounts: PublicKey[], data: Buffer): Decoded {
  const [consensus, , ...remaining] = accounts;
  if (!consensus) return unknown("malformed spend");
  const [{ args }] = generated.executeTransactionSyncV2Struct.deserialize(data);
  if (args.accountIndex !== PRIMARY_ACCOUNT_INDEX) {
    return unknown("spend from an account index this package never uses");
  }
  if (args.payload.__kind !== "Policy") {
    return unknown("synchronous transaction outside a policy");
  }
  const signers = remaining.slice(0, args.numSigners);
  const rest = remaining.slice(args.numSigners);
  if (signers.length !== args.numSigners)
    return unknown("spend names fewer signers than it counts");

  const payload = args.payload.fields[0];
  if (payload.__kind === "SpendingLimit") {
    const [{ amount, destination, decimals }] = payload.fields;
    const [vault, second, third] = rest;
    if (!vault || !second)
      return unknown("spending-limit spend is missing its accounts");
    if (rest.length === 3 && third?.equals(SYSTEM_PROGRAM_ID)) {
      return {
        kind: "spend",
        spend: {
          kind: "spend",
          vault,
          consensus,
          route: "spending-limit",
          signers,
          destination: second,
          destinationTokenAccount: null,
          mint: "SOL",
          amount: toBigInt(amount),
          decimals,
          opensDestinationTokenAccount: false,
        },
      };
    }
    const [, vaultTokenAccount, destinationTokenAccount, mint, tokenProgram] =
      rest;
    if (
      rest.length !== 5 ||
      !destinationTokenAccount ||
      !mint ||
      !tokenProgram
    ) {
      return unknown("spending-limit spend carries an unexpected account list");
    }
    if (
      !vaultTokenAccount?.equals(
        associatedTokenAddress(vault, mint, tokenProgram),
      )
    ) {
      return unknown(
        "spending-limit spend does not draw on the vault's token account",
      );
    }
    return {
      kind: "spend",
      spend: {
        kind: "spend",
        vault,
        consensus,
        route: "spending-limit",
        signers,
        destination,
        destinationTokenAccount,
        mint,
        amount: toBigInt(amount),
        decimals,
        opensDestinationTokenAccount: false,
      },
    };
  }

  if (payload.__kind === "ProgramInteraction") {
    const [{ transactionPayload }] = payload.fields;
    if (transactionPayload.__kind !== "SyncTransaction") {
      return unknown("above-limit spend carries an asynchronous payload");
    }
    const [{ accountIndex, instructions }] = transactionPayload.fields;
    if (accountIndex !== PRIMARY_ACCOUNT_INDEX) {
      return unknown(
        "above-limit spend from an account index this package never uses",
      );
    }
    const inner = parseInnerInstructions(Buffer.from(instructions), rest);
    if (inner.kind === "unknown") return inner;
    if (inner.instructions.length !== 1) {
      return unknown(
        `above-limit spend wraps ${inner.instructions.length} instructions, not one transfer`,
      );
    }
    const [only] = inner.instructions;
    const transfer = decodeInstruction(
      only!.programId,
      only!.accounts,
      only!.data,
    );
    if (transfer.kind !== "transfer") {
      return transfer.kind === "unknown"
        ? transfer
        : unknown("above-limit spend wraps something other than a transfer");
    }
    return {
      kind: "spend",
      spend: {
        kind: "spend",
        vault: transfer.transfer.source,
        consensus,
        route: "above-limit",
        signers,
        destination: transfer.transfer.destination,
        destinationTokenAccount: transfer.transfer.destinationTokenAccount,
        mint: transfer.transfer.mint,
        amount: transfer.transfer.amount,
        decimals: transfer.transfer.mint === "SOL" ? 9 : null,
        opensDestinationTokenAccount: false,
      },
    };
  }

  return unknown(`spend under a ${payload.__kind} policy`);
}

/** The wire form `instructionsToSynchronousTransactionDetails` writes. */
function parseInnerInstructions(
  bytes: Buffer,
  accounts: PublicKey[],
):
  | {
      kind: "ok";
      instructions: {
        programId: PublicKey;
        accounts: PublicKey[];
        data: Buffer;
      }[];
    }
  | UnknownDescription {
  let offset = 0;
  const count = bytes[offset++];
  if (count === undefined) return unknown("empty inner instruction list");
  const instructions = [];
  for (let i = 0; i < count; i++) {
    const programIdIndex = bytes[offset++];
    const accountCount = bytes[offset++];
    if (programIdIndex === undefined || accountCount === undefined) {
      return unknown("truncated inner instruction");
    }
    const programId = accounts[programIdIndex];
    if (!programId)
      return unknown("inner instruction names a program off the account list");
    const ixAccounts: PublicKey[] = [];
    for (let j = 0; j < accountCount; j++) {
      const index = bytes[offset++];
      const key = index === undefined ? undefined : accounts[index];
      if (!key)
        return unknown(
          "inner instruction names an account off the account list",
        );
      ixAccounts.push(key);
    }
    if (offset + 2 > bytes.length)
      return unknown("truncated inner instruction");
    const dataLength = bytes.readUInt16LE(offset);
    offset += 2;
    if (offset + dataLength > bytes.length)
      return unknown("truncated inner instruction");
    instructions.push({
      programId,
      accounts: ixAccounts,
      data: bytes.subarray(offset, offset + dataLength),
    });
    offset += dataLength;
  }
  if (offset !== bytes.length)
    return unknown("trailing bytes after the inner instructions");
  return { kind: "ok", instructions };
}

function decodeSystem(accounts: PublicKey[], data: Buffer): Decoded {
  if (data.length !== 12 || data.readUInt32LE(0) !== SYSTEM_TRANSFER) {
    return unknown("System instruction other than a transfer");
  }
  const [from, to] = accounts;
  if (!from || !to) return unknown("malformed System transfer");
  return {
    kind: "transfer",
    transfer: {
      kind: "transfer",
      source: from,
      destination: to,
      destinationTokenAccount: null,
      mint: "SOL",
      amount: data.readBigUInt64LE(4),
      opensDestinationTokenAccount: false,
    },
  };
}

function decodeToken(accounts: PublicKey[], data: Buffer): Decoded {
  if (data.length !== 10 || data[0] !== TOKEN_TRANSFER_CHECKED) {
    return unknown("Token instruction other than TransferChecked");
  }
  const [, mint, destinationTokenAccount, authority] = accounts;
  if (!mint || !destinationTokenAccount || !authority) {
    return unknown("malformed TransferChecked");
  }
  return {
    kind: "transfer",
    transfer: {
      kind: "transfer",
      source: authority,
      destination: null,
      destinationTokenAccount,
      mint,
      amount: data.readBigUInt64LE(1),
      opensDestinationTokenAccount: false,
    },
  };
}

function decodeAssociatedToken(accounts: PublicKey[], data: Buffer): Decoded {
  const create =
    data.length === 0 ||
    (data.length === 1 && (data[0] === 0 || data[0] === 1));
  if (!create) return unknown("Associated Token instruction other than create");
  const [, ata, owner, mint, , tokenProgram] = accounts;
  if (!ata || !owner || !mint || !tokenProgram) {
    return unknown("malformed associated token account creation");
  }
  if (!ata.equals(associatedTokenAddress(owner, mint, tokenProgram))) {
    return unknown("associated token account does not derive from its owner");
  }
  return { kind: "open-token-account", ata, owner, mint };
}

function assemble(
  decoded: Decoded[],
  context: DescribeContext,
): TransactionDescription {
  const spends = decoded.filter((d) => d.kind === "spend");
  const proposes = decoded.filter((d) => d.kind === "propose");
  const proposals = decoded.filter((d) => d.kind === "create-proposal");
  const votes = decoded.filter((d) => d.kind === "vote");
  const transfers = decoded.filter((d) => d.kind === "transfer");
  const opens = decoded.filter((d) => d.kind === "open-token-account");

  if (proposes.length > 0) {
    if (spends.length || transfers.length || opens.length) {
      return unknown("a settings change travelling with a transfer");
    }
    return assembleSettingsChange(proposes, proposals, votes, context);
  }

  if (spends.length > 0) {
    if (
      spends.length > 1 ||
      proposals.length ||
      votes.length ||
      transfers.length
    ) {
      return unknown("more than one thing moves money in this message");
    }
    const spend = spends[0]!.spend;
    const opened = adoptOpenedAccount(spend, opens);
    if (opened.kind === "unknown") return opened;
    if (!spend.vault.equals(context.addresses.vault)) {
      return unknown("the spend leaves an account other than this one");
    }
    return {
      ...spend,
      destination: opened.destination,
      opensDestinationTokenAccount: opened.opensDestinationTokenAccount,
      route: routeOf(spend, context),
    };
  }

  if (votes.length > 0) {
    if (proposals.length || transfers.length || opens.length) {
      return unknown("a vote travelling with something else");
    }
    return assembleVotes(votes, context);
  }

  if (transfers.length === 1 && proposals.length === 0) {
    const transfer = transfers[0]!.transfer;
    const opened = adoptOpenedAccount(transfer, opens);
    if (opened.kind === "unknown") return opened;
    return {
      ...transfer,
      destination: opened.destination,
      opensDestinationTokenAccount: opened.opensDestinationTokenAccount,
    };
  }

  return unknown(
    transfers.length
      ? "more than one transfer"
      : "nothing this signer recognises",
  );
}

/**
 * An associated token account opened in the same message is only acceptable
 * when it is the one the transfer pays into; it then also tells us who owns it.
 */
function adoptOpenedAccount(
  transfer: {
    destination: PublicKey | null;
    destinationTokenAccount: PublicKey | null;
    mint: PublicKey | "SOL";
  },
  opens: Extract<Decoded, { kind: "open-token-account" }>[],
):
  | {
      kind: "ok";
      destination: PublicKey | null;
      opensDestinationTokenAccount: boolean;
    }
  | UnknownDescription {
  if (opens.length === 0) {
    return {
      kind: "ok",
      destination: transfer.destination,
      opensDestinationTokenAccount: false,
    };
  }
  if (opens.length > 1) return unknown("opens more than one token account");
  const open = opens[0]!;
  if (
    transfer.mint === "SOL" ||
    !open.mint.equals(transfer.mint) ||
    !transfer.destinationTokenAccount?.equals(open.ata)
  ) {
    return unknown("opens a token account the transfer does not pay into");
  }
  if (transfer.destination && !transfer.destination.equals(open.owner)) {
    return unknown(
      "opens a token account for someone other than the destination",
    );
  }
  return {
    kind: "ok",
    destination: open.owner,
    opensDestinationTokenAccount: true,
  };
}

function routeOf(
  spend: SpendDescription,
  context: DescribeContext,
): DescribedSpendRoute {
  if (deriveVaultAddress(spend.consensus).equals(context.addresses.vault)) {
    return "settings";
  }
  if (context.spendingLimitPolicy?.equals(spend.consensus))
    return "spending-limit";
  if (context.aboveLimitPolicy?.equals(spend.consensus)) return "above-limit";
  return spend.route;
}

function assembleSettingsChange(
  proposes: Extract<Decoded, { kind: "propose" }>[],
  proposals: Extract<Decoded, { kind: "create-proposal" }>[],
  votes: Extract<Decoded, { kind: "vote" }>[],
  context: DescribeContext,
): TransactionDescription {
  if (proposes.length !== 1 || proposals.length !== 1) {
    return unknown("a settings change needs exactly one proposal");
  }
  const propose = proposes[0]!;
  const proposal = proposals[0]!;
  const { settings } = propose;
  const owned = assertOwned(settings, context);
  if (owned) return owned;
  if (!proposal.consensus.equals(settings)) {
    return unknown("proposal is for a different Settings than the change");
  }
  const index = proposal.transactionIndex;
  const expectedTransaction = getTransactionPda({
    settingsPda: settings,
    transactionIndex: index,
  })[0];
  const expectedProposal = getProposalPda({
    settingsPda: settings,
    transactionIndex: index,
  })[0];
  if (
    !propose.transaction.equals(expectedTransaction) ||
    !proposal.proposal.equals(expectedProposal)
  ) {
    return unknown(
      "the change and its proposal disagree on the transaction index",
    );
  }
  for (const v of votes) {
    if (!v.consensus.equals(settings) || !v.proposal.equals(expectedProposal)) {
      return unknown("a vote in this message is for a different change");
    }
  }

  const actions: SettingsChangeAction[] = [];
  for (const action of propose.actions) {
    actions.push(describeAction(action, settings));
  }

  return {
    kind: "settings",
    settings,
    vault: context.addresses.vault,
    transactionIndex: index,
    proposer: propose.proposer,
    actions,
    votes: votes.map((v) => v.vote),
  };
}

function assembleVotes(
  votes: Extract<Decoded, { kind: "vote" }>[],
  context: DescribeContext,
): TransactionDescription {
  const [first] = votes;
  const settings = first!.consensus;
  const owned = assertOwned(settings, context);
  if (owned) return owned;
  for (const v of votes) {
    if (!v.consensus.equals(settings) || !v.proposal.equals(first!.proposal)) {
      return unknown("votes in this message are for different changes");
    }
  }
  return {
    kind: "vote",
    settings,
    vault: context.addresses.vault,
    proposal: first!.proposal,
    votes: votes.map((v) => v.vote),
  };
}

function assertOwned(
  settings: PublicKey,
  context: DescribeContext,
): UnknownDescription | null {
  if (
    context.addresses.settings &&
    !context.addresses.settings.equals(settings)
  ) {
    return unknown("Settings account is not this Account's");
  }
  if (!deriveVaultAddress(settings).equals(context.addresses.vault)) {
    return unknown("Settings account does not belong to this Account");
  }
  return null;
}

function describeAction(
  action: generated.SettingsAction,
  settings: PublicKey,
): SettingsChangeAction {
  switch (action.__kind) {
    case "AddSigner":
      return {
        kind: "add-signer",
        key: action.newSigner.key,
        permissions: action.newSigner.permissions.mask,
      };
    case "RemoveSigner":
      return { kind: "remove-signer", key: action.oldSigner };
    case "SetTimeLock":
      return { kind: "set-time-lock", seconds: action.newTimeLock };
    case "ChangeThreshold":
      return { kind: "change-threshold", threshold: action.newThreshold };
    case "PolicyCreate": {
      const seed = toBigInt(action.seed);
      const terms = describeTerms(action.policyCreationPayload, action);
      return {
        kind: "policy-create",
        policy: getPolicyPda({
          settingsPda: settings,
          policySeed: seed as unknown as number,
        })[0],
        seed,
        terms,
        summary: summarise(terms),
      };
    }
    case "PolicyUpdate": {
      const terms = describeTerms(action.policyUpdatePayload, action);
      return {
        kind: "policy-update",
        policy: action.policy,
        terms,
        summary: summarise(terms),
      };
    }
    case "PolicyRemove":
      return { kind: "policy-remove", policy: action.policy };
    default:
      return { kind: "other", name: action.__kind };
  }
}

function describeTerms(
  payload: generated.PolicyCreationPayload,
  policy: {
    signers: generated.SmartAccountSigner[];
    threshold: number;
    timeLock: number;
  },
): PolicyTerms {
  const signers = policy.signers.map((s) => s.key);
  const base = {
    signers,
    threshold: policy.threshold,
    timeLock: policy.timeLock,
  };
  if (payload.__kind === "SpendingLimit") {
    const [limit] = payload.fields;
    return {
      kind: "spending-limit",
      mint: limit.mint.equals(NATIVE_MINT) ? "SOL" : limit.mint,
      maxPerUse: toBigInt(limit.quantityConstraints.maxPerUse),
      maxPerPeriod: toBigInt(limit.quantityConstraints.maxPerPeriod),
      period: limit.timeConstraints.period.__kind,
      destinations: limit.destinations,
      ...base,
    };
  }
  if (payload.__kind === "ProgramInteraction") {
    const [interaction] = payload.fields;
    return {
      kind: "program-interaction",
      allowedPrograms: interaction.instructionsConstraints.map(
        (c) => c.programId,
      ),
      programOnly: interaction.instructionsConstraints.every(
        (c) =>
          c.accountConstraints.length === 0 && c.dataConstraints.length === 0,
      ),
      ...base,
    };
  }
  return { kind: "other", name: payload.__kind, ...base };
}

function summarise(terms: PolicyTerms): string {
  const signers = `${terms.threshold} of ${terms.signers.length} signer${terms.signers.length === 1 ? "" : "s"}`;
  switch (terms.kind) {
    case "spending-limit":
      return `spending limit of ${terms.maxPerUse} per use and ${terms.maxPerPeriod} per ${terms.period.toLowerCase()} period in ${
        terms.mint === "SOL" ? "SOL" : terms.mint.toBase58()
      }, ${signers}`;
    case "program-interaction":
      return `program access to ${terms.allowedPrograms.length} program${terms.allowedPrograms.length === 1 ? "" : "s"}, ${signers}`;
    default:
      return `${terms.name} policy, ${signers}`;
  }
}

function unknown(reason: string): UnknownDescription {
  return { kind: "unknown", reason };
}

/** The SDK's u64s are BN at runtime whatever the declaration says. */
function toBigInt(value: unknown): bigint {
  return BigInt((value as { toString(): string }).toString());
}

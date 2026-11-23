import {
  AddressLookupTableAccount,
  MessageAccountKeys,
  MessageV0,
  PublicKey,
  VersionedTransaction,
  type AccountInfo,
  type Connection,
} from "@solana/web3.js";
import {
  accounts as squadsAccounts,
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
  JUPITER_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  WRAPPED_SOL_MINT,
} from "./programs.js";
import { associatedTokenAddress } from "./spend.js";
import {
  JUPITER_ROUTE_ACCOUNTS,
  minimumAmountOut,
  readJupiterRouteTerms,
  TOKEN_ACCOUNT_RENT_LAMPORTS,
} from "./swap.js";

const PRIMARY_ACCOUNT_INDEX = 0;
const NATIVE_MINT = PublicKey.default;

const SYSTEM_TRANSFER = 2;
const TOKEN_TRANSFER_CHECKED = 12;
const TOKEN_CLOSE_ACCOUNT = 9;
const TOKEN_SYNC_NATIVE = 17;
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
  | SwapDescription
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

/**
 * One asset in the vault exchanged for another, through Jupiter.
 *
 * Nothing leaves the Account: both sides are the vault's own. What a signer
 * has to hold it to is the pair, the amount paid, and the least it may
 * receive, because the policy it executes under checks none of those.
 */
export interface SwapDescription {
  kind: "swap";
  vault: PublicKey;
  consensus: PublicKey;
  signers: PublicKey[];
  inputMint: PublicKey | "SOL";
  outputMint: PublicKey | "SOL";
  /** In the input mint's smallest units. */
  amountIn: bigint;
  /** What the route was priced at, in the output mint's smallest units. */
  quotedAmountOut: bigint;
  slippageBps: number;
  /** Jupiter fails the swap if the vault would receive less than this. */
  minimumAmountOut: bigint;
  /**
   * True when the swap repays the fee payer the rent of the wrapped SOL
   * account it closes. Never more than one token account's rent, and never to
   * anyone but the fee payer.
   */
  refundsRent: boolean;
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

/**
 * What a policy would hold. `expires` is true when the policy stops working
 * at a set time: one that does takes every Spend made under it down with it.
 */
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
      expires: boolean;
    }
  | {
      kind: "program-interaction";
      allowedPrograms: PublicKey[];
      /** False when a constraint carries account or data rules beyond the program id. */
      programOnly: boolean;
      signers: PublicKey[];
      threshold: number;
      timeLock: number;
      expires: boolean;
    }
  | {
      kind: "other";
      name: string;
      signers: PublicKey[];
      threshold: number;
      timeLock: number;
      expires: boolean;
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

  const feePayer = keys.get(0);
  if (!feePayer) return unknown("message has no fee payer");

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

  return assemble(decoded, context, feePayer);
}

interface DecodedSwap {
  kind: "swap";
  swap: SwapDescription;
  /** The mints as the route names them, where SOL is its wrapped mint. */
  sourceMint: PublicKey;
  destinationMint: PublicKey;
  rentRefundTo: PublicKey | null;
}

type Decoded =
  | { kind: "spend"; spend: SpendDescription }
  | DecodedSwap
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
      /** Who pays the rent if the account does not exist yet. */
      payer: PublicKey;
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
    if (
      inner.instructions.some((ix) => ix.programId.equals(JUPITER_PROGRAM_ID))
    ) {
      return decodeSwap(consensus, signers, inner.instructions);
    }
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

interface InnerInstruction {
  programId: PublicKey;
  accounts: PublicKey[];
  data: Buffer;
}

/**
 * Reads a swap out of the instructions an above-limit Spend wraps.
 *
 * The policy admits any Jupiter instruction, so this is deliberately narrow:
 * one `shared_accounts_route` between two of the vault's own token accounts,
 * with SOL wrapped before it and unwrapped after it and nothing else. A route
 * that does not fit is refused rather than read loosely, because a loose read
 * here is the only thing a wrong swap would have to get past.
 */
function decodeSwap(
  consensus: PublicKey,
  signers: PublicKey[],
  inner: InnerInstruction[],
): Decoded {
  const routeAt = inner.findIndex((ix) =>
    ix.programId.equals(JUPITER_PROGRAM_ID),
  );
  const route = inner[routeAt]!;
  const terms = readJupiterRouteTerms(route.data);
  if (!terms) {
    return unknown(
      "swap through a Jupiter instruction this signer cannot read",
    );
  }
  const at = JUPITER_ROUTE_ACCOUNTS;
  if (route.accounts.length < at.fixedLength) {
    return unknown("malformed swap route");
  }
  const vault = route.accounts[at.transferAuthority]!;
  const source = route.accounts[at.source]!;
  const destination = route.accounts[at.destination]!;
  const sourceMint = route.accounts[at.sourceMint]!;
  const destinationMint = route.accounts[at.destinationMint]!;

  if (!route.accounts[at.program]!.equals(JUPITER_PROGRAM_ID)) {
    return unknown("malformed swap route");
  }
  // Jupiter passes its own program id where an optional account is absent.
  if (
    terms.platformFeeBps !== 0 ||
    !route.accounts[at.platformFee]!.equals(JUPITER_PROGRAM_ID)
  ) {
    return unknown("swap pays a fee to a third party");
  }
  if (sourceMint.equals(destinationMint)) {
    return unknown("swap of an asset for itself");
  }
  // Each hop is handed a slice of the accounts after the fixed ones. The
  // vault's signature travels with it into any hop that names it, so a route
  // that did could spend from a token account that is no part of this swap.
  if (
    route.accounts.some(
      (account, i) => account.equals(vault) && i !== at.transferAuthority,
    )
  ) {
    return unknown("swap route hands the vault's signature to a venue");
  }
  if (!isAssociatedTokenAccount(source, vault, sourceMint)) {
    return unknown("swap does not draw on the vault's token account");
  }
  if (!isAssociatedTokenAccount(destination, vault, destinationMint)) {
    return unknown("swap does not pay into the vault's token account");
  }

  const wrappedSol = associatedTokenAddress(
    vault,
    WRAPPED_SOL_MINT,
    TOKEN_PROGRAM_ID,
  );
  const before = inner.slice(0, routeAt);
  const after = inner.slice(routeAt + 1);

  let wrapsInput = false;
  if (before.length > 0) {
    const [fund, sync, ...extra] = before;
    const funded = fund && readSystemTransfer(fund);
    if (
      extra.length > 0 ||
      !funded ||
      !funded.from.equals(vault) ||
      !funded.to.equals(wrappedSol) ||
      funded.lamports !== terms.amountIn ||
      !sync ||
      !isTokenInstruction(sync, TOKEN_SYNC_NATIVE, [wrappedSol]) ||
      !source.equals(wrappedSol)
    ) {
      return unknown("swap is preceded by something other than wrapping SOL");
    }
    wrapsInput = true;
  }

  let closesWrappedSol = false;
  let rentRefundTo: PublicKey | null = null;
  const [first, second, ...extra] = after;
  if (extra.length > 0) {
    return unknown("swap is followed by more than unwrapping SOL");
  }
  if (first) {
    if (
      !isTokenInstruction(first, TOKEN_CLOSE_ACCOUNT, [
        wrappedSol,
        vault,
        vault,
      ])
    ) {
      return unknown("swap is followed by something other than unwrapping SOL");
    }
    closesWrappedSol = true;
  }
  if (second) {
    const refund = readSystemTransfer(second);
    if (
      !refund ||
      !refund.from.equals(vault) ||
      refund.to.equals(vault) ||
      refund.lamports !== TOKEN_ACCOUNT_RENT_LAMPORTS
    ) {
      return unknown(
        "swap is followed by a transfer that is not a rent refund",
      );
    }
    rentRefundTo = refund.to;
  }

  const unwrapsOutput =
    closesWrappedSol && destination.equals(wrappedSol) && !wrapsInput;
  if (wrapsInput !== (closesWrappedSol && !unwrapsOutput)) {
    return unknown(
      "swap wraps SOL without unwrapping what is left, or the reverse",
    );
  }

  return {
    kind: "swap",
    sourceMint,
    destinationMint,
    rentRefundTo,
    swap: {
      kind: "swap",
      vault,
      consensus,
      signers,
      inputMint: wrapsInput ? "SOL" : sourceMint,
      outputMint: unwrapsOutput ? "SOL" : destinationMint,
      amountIn: terms.amountIn,
      quotedAmountOut: terms.quotedAmountOut,
      slippageBps: terms.slippageBps,
      minimumAmountOut: minimumAmountOut(
        terms.quotedAmountOut,
        terms.slippageBps,
      ),
      refundsRent: rentRefundTo !== null,
    },
  };
}

function isAssociatedTokenAccount(
  account: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
): boolean {
  return [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].some((tokenProgram) =>
    account.equals(associatedTokenAddress(owner, mint, tokenProgram)),
  );
}

function readSystemTransfer(
  ix: InnerInstruction,
): { from: PublicKey; to: PublicKey; lamports: bigint } | null {
  const [from, to] = ix.accounts;
  if (
    !ix.programId.equals(SYSTEM_PROGRAM_ID) ||
    ix.data.length !== 12 ||
    ix.data.readUInt32LE(0) !== SYSTEM_TRANSFER ||
    ix.accounts.length !== 2 ||
    !from ||
    !to
  ) {
    return null;
  }
  return { from, to, lamports: ix.data.readBigUInt64LE(4) };
}

function isTokenInstruction(
  ix: InnerInstruction,
  tag: number,
  accounts: PublicKey[],
): boolean {
  return (
    ix.programId.equals(TOKEN_PROGRAM_ID) &&
    ix.data.length === 1 &&
    ix.data[0] === tag &&
    ix.accounts.length === accounts.length &&
    accounts.every((account, i) => account.equals(ix.accounts[i]!))
  );
}

/** The wire form `instructionsToSynchronousTransactionDetails` writes. */
function parseInnerInstructions(
  bytes: Buffer,
  accounts: PublicKey[],
): { kind: "ok"; instructions: InnerInstruction[] } | UnknownDescription {
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
  const [payer, ata, owner, mint, , tokenProgram] = accounts;
  if (!payer || !ata || !owner || !mint || !tokenProgram) {
    return unknown("malformed associated token account creation");
  }
  if (!ata.equals(associatedTokenAddress(owner, mint, tokenProgram))) {
    return unknown("associated token account does not derive from its owner");
  }
  return { kind: "open-token-account", payer, ata, owner, mint };
}

function assemble(
  decoded: Decoded[],
  context: DescribeContext,
  feePayer: PublicKey,
): TransactionDescription {
  const spends = decoded.filter((d) => d.kind === "spend");
  const swaps = decoded.filter((d) => d.kind === "swap");
  const proposes = decoded.filter((d) => d.kind === "propose");
  const proposals = decoded.filter((d) => d.kind === "create-proposal");
  const votes = decoded.filter((d) => d.kind === "vote");
  const transfers = decoded.filter((d) => d.kind === "transfer");
  const opens = decoded.filter((d) => d.kind === "open-token-account");

  if (swaps.length > 0) {
    if (
      swaps.length > 1 ||
      spends.length ||
      proposes.length ||
      proposals.length ||
      votes.length ||
      transfers.length
    ) {
      return unknown("a swap travelling with something else");
    }
    return assembleSwap(swaps[0]!, opens, context, feePayer);
  }

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
 * A swap may open the vault's own account for either side of the pair, and
 * nothing else: an account opened for anyone but the vault is rent spent on a
 * stranger, and one for a third mint has no part in the swap.
 */
function assembleSwap(
  decoded: DecodedSwap,
  opens: Extract<Decoded, { kind: "open-token-account" }>[],
  context: DescribeContext,
  feePayer: PublicKey,
): TransactionDescription {
  const { swap } = decoded;
  if (!swap.vault.equals(context.addresses.vault)) {
    return unknown("the swap spends from an account other than this one");
  }
  if (opens.length > 2) return unknown("opens more than a swap's two accounts");
  for (const open of opens) {
    const ofThePair =
      open.mint.equals(decoded.sourceMint) ||
      open.mint.equals(decoded.destinationMint);
    if (!open.owner.equals(swap.vault) || !ofThePair) {
      return unknown("opens a token account the swap does not use");
    }
  }
  if (decoded.rentRefundTo) {
    if (!decoded.rentRefundTo.equals(feePayer)) {
      return unknown(
        "the swap refunds rent to someone other than the fee payer",
      );
    }
    // A refund is only owed for rent the fee payer puts up here. Without the
    // opening instruction the wrapped SOL account was already the vault's,
    // rent included, and the refund would be the vault's own money leaving.
    // Whether the account already exists cannot be read from a message, so
    // whoever signs still has to check that against the chain.
    const fronted = opens.some(
      (open) =>
        open.mint.equals(WRAPPED_SOL_MINT) && open.payer.equals(feePayer),
    );
    if (!fronted) {
      return unknown("the swap refunds rent the fee payer did not put up");
    }
  }
  return swap;
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

/** A settings change as the chain holds it while it waits to be executed. */
export interface StagedSettingsChange {
  settings: PublicKey;
  proposal: PublicKey;
  transactionIndex: bigint;
  actions: SettingsChangeAction[];
}

/**
 * Reads the change a proposal stands for, or null when there is none to read.
 *
 * An approval or an execute names a proposal and nothing about what it does,
 * so a signer shown only that instruction is approving blind. This is what
 * lets it look. Both accounts are found by address derivation from the
 * Account's own settings, so what comes back is what the program will act on
 * and not something another party could put in its place.
 */
export async function fetchStagedSettingsChange(
  connection: Connection,
  settings: PublicKey,
  proposal: PublicKey,
): Promise<StagedSettingsChange | null> {
  const proposalInfo = await connection.getAccountInfo(proposal);
  if (!isSquadsAccount(proposalInfo, squadsAccounts.proposalDiscriminator)) {
    return null;
  }
  const [held] = squadsAccounts.Proposal.fromAccountInfo(proposalInfo);
  const transactionIndex = toBigInt(held.transactionIndex);
  const derived = getProposalPda({
    settingsPda: settings,
    transactionIndex,
  })[0];
  if (!derived.equals(proposal)) return null;

  const [transaction] = getTransactionPda({
    settingsPda: settings,
    transactionIndex,
  });
  const info = await connection.getAccountInfo(transaction);
  if (!isSquadsAccount(info, squadsAccounts.settingsTransactionDiscriminator)) {
    return null;
  }
  const [change] = squadsAccounts.SettingsTransaction.fromAccountInfo(info);
  return {
    settings,
    proposal,
    transactionIndex,
    actions: change.actions.map((action) => describeAction(action, settings)),
  };
}

function isSquadsAccount(
  info: AccountInfo<Buffer> | null,
  discriminator: readonly number[],
): info is AccountInfo<Buffer> {
  return (
    info !== null &&
    info.owner.equals(PROGRAM_ID) &&
    discriminator.every((byte, i) => info.data[i] === byte)
  );
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
    expirationArgs?: unknown;
  },
): PolicyTerms {
  const signers = policy.signers.map((s) => s.key);
  const base = {
    signers,
    threshold: policy.threshold,
    timeLock: policy.timeLock,
    expires:
      policy.expirationArgs !== null && policy.expirationArgs !== undefined,
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

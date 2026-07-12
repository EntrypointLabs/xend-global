import {
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from "@solana/kit";
import {
  AssociatedTokenInstruction,
  getTransferCheckedInstructionDataDecoder,
  identifyAssociatedTokenInstruction,
  identifyTokenInstruction,
  TokenInstruction,
} from "@solana-program/token";
import {
  ComputeBudgetInstruction,
  getSetComputeUnitLimitInstructionDataDecoder,
  getSetComputeUnitPriceInstructionDataDecoder,
  identifyComputeBudgetInstruction,
} from "@solana-program/compute-budget";
import {
  ASSOCIATED_TOKEN_PROGRAM,
  COMPUTE_BUDGET_PROGRAM,
  TOKEN_PROGRAM,
  type RelayerConfig,
} from "../relayer-config";
import {
  AddressLookupTableForbiddenError,
  FeeCeilingExceededError,
  FeePayerWritableError,
  InstructionNotAllowedError,
  InvalidSignerCountError,
  MessageMismatchError,
  MissingSignatureError,
  UnsupportedMintError,
  WrongDecimalsError,
  WrongDestinationError,
  WrongFeePayerError,
} from "./cosign.errors";

/** Base fee per signature on Solana, in lamports. */
const LAMPORTS_PER_SIGNATURE = 5000n;

export interface ValidatedSettlement {
  amount: bigint;
  computeUnitPrice: bigint;
  computeUnitLimit: number;
  estimatedFeeLamports: bigint;
}

/**
 * Validate the FULLY-ASSEMBLED transaction bytes before any signing. Throws
 * the typed error on the first failure, so a rejected request never reaches
 * simulate/sign/broadcast. This is the anti-drain surface (PITFALLS.md 4.2):
 * the relayer co-signs ONLY platform-compiled settlement transactions.
 *
 * The System program is deliberately ABSENT from the allowlist. Research
 * listed System for settlement-account creation, but a System lamport
 * transfer from the fee payer is the drain vector; settlement-account
 * provisioning is a separate Phase 4 ops path, never co-signed on the
 * payment hot path.
 */
export function validateSettlementTransaction(
  wireTxBase64: string,
  cfg: RelayerConfig,
  expected: { settlementAccount: string; messageBase64?: string },
): ValidatedSettlement {
  const txBytes = getBase64Encoder().encode(wireTxBase64);
  const tx = getTransactionDecoder().decode(txBytes);
  const msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);

  // Settlement transactions are compiled v0 (or legacy). Reject the v1
  // message format: its instruction layout differs and it is outside the
  // platform's compilation path, so co-signing it is out of template.
  if (msg.version === 1) {
    throw new InstructionNotAllowedError(
      "v1 transaction messages are not supported",
    );
  }

  const staticAccounts = msg.staticAccounts.map((a) => a as string);

  // No address lookup tables: v1 requires all accounts static so writability
  // is derivable and vendor-policy parity holds (STACK.md).
  const lookups =
    "addressTableLookups" in msg ? msg.addressTableLookups : undefined;
  if (lookups && lookups.length > 0) {
    throw new AddressLookupTableForbiddenError(
      "address lookup tables are not permitted",
    );
  }

  // Fee payer is account index 0 and equals the configured fee payer.
  if (
    staticAccounts.length === 0 ||
    staticAccounts[0] !== cfg.feePayerAddress
  ) {
    throw new WrongFeePayerError(
      "fee payer (account index 0) does not match the configured relayer key",
    );
  }

  // Exactly two required signers: Consumer + relayer.
  if (msg.header.numSignerAccounts !== 2) {
    throw new InvalidSignerCountError(
      `expected exactly 2 signers, got ${msg.header.numSignerAccounts}`,
    );
  }

  // Fee payer never appears in ANY instruction's account list (never a
  // writable non-fee account). This also forbids a fee-payer-funded ATA
  // create (rent-refund farming, PITFALLS.md 4.2).
  for (const ix of msg.instructions) {
    for (const idx of ix.accountIndices ?? []) {
      if (staticAccounts[idx] === cfg.feePayerAddress) {
        throw new FeePayerWritableError(
          "fee payer must not appear as a writable account in any instruction",
        );
      }
    }
  }

  // Instruction allowlist: ComputeBudget, Token, ATA only. System excluded.
  for (const ix of msg.instructions) {
    const program = staticAccounts[ix.programAddressIndex];
    if (!cfg.programAllowlist.includes(program)) {
      throw new InstructionNotAllowedError(
        `program ${program} is not in the settlement allowlist`,
      );
    }
  }

  // Exactly one SPL Token instruction and it must be TransferChecked to the
  // expected settlement account, USDC mint, decimals 6.
  const tokenIxs = msg.instructions.filter(
    (ix) => staticAccounts[ix.programAddressIndex] === TOKEN_PROGRAM,
  );
  if (tokenIxs.length !== 1) {
    throw new InstructionNotAllowedError(
      `expected exactly one SPL Token instruction, got ${tokenIxs.length}`,
    );
  }
  const tokenIx = tokenIxs[0];
  if (!tokenIx.data) {
    throw new InstructionNotAllowedError("token instruction has no data");
  }
  if (
    identifyTokenInstruction(tokenIx.data) !== TokenInstruction.TransferChecked
  ) {
    throw new InstructionNotAllowedError(
      "the only permitted SPL Token instruction is TransferChecked",
    );
  }
  const transfer = getTransferCheckedInstructionDataDecoder().decode(
    tokenIx.data,
  );
  if (transfer.decimals !== 6) {
    throw new WrongDecimalsError(
      `TransferChecked decimals must be 6, got ${transfer.decimals}`,
    );
  }
  const tokenAccts = tokenIx.accountIndices ?? [];
  if (tokenAccts.length < 4) {
    throw new InstructionNotAllowedError(
      "TransferChecked is missing required accounts",
    );
  }
  // TransferChecked accounts: [source, mint, destination, authority].
  const mint = staticAccounts[tokenAccts[1]];
  const destination = staticAccounts[tokenAccts[2]];
  if (mint !== cfg.usdcMint) {
    throw new UnsupportedMintError(
      `mint ${mint} is not the configured USDC mint`,
    );
  }
  if (destination !== expected.settlementAccount) {
    throw new WrongDestinationError(
      "TransferChecked destination is not the expected settlement account",
    );
  }

  // Any ATA instruction, if present, must be the idempotent-create variant
  // targeting the expected settlement account only. (Fee-payer-not-writable
  // above already forbids the fee payer funding it.)
  const ataIxs = msg.instructions.filter(
    (ix) => staticAccounts[ix.programAddressIndex] === ASSOCIATED_TOKEN_PROGRAM,
  );
  for (const ix of ataIxs) {
    if (
      !ix.data ||
      identifyAssociatedTokenInstruction(ix.data) !==
        AssociatedTokenInstruction.CreateAssociatedTokenIdempotent
    ) {
      throw new InstructionNotAllowedError(
        "the only permitted Associated Token instruction is idempotent create",
      );
    }
    const ataAccts = ix.accountIndices ?? [];
    // ATA CreateIdempotent accounts: [payer, ata, owner, mint, system, token].
    if (
      ataAccts.length < 2 ||
      staticAccounts[ataAccts[1]] !== expected.settlementAccount
    ) {
      throw new WrongDestinationError(
        "ATA create must target the expected settlement account",
      );
    }
  }

  // Fee ceiling: decode ComputeBudget price/limit and reject over ceiling.
  let computeUnitPrice = 0n;
  let computeUnitLimit = 0;
  const cbIxs = msg.instructions.filter(
    (ix) => staticAccounts[ix.programAddressIndex] === COMPUTE_BUDGET_PROGRAM,
  );
  for (const ix of cbIxs) {
    if (!ix.data) continue;
    const kind = identifyComputeBudgetInstruction(ix.data);
    if (kind === ComputeBudgetInstruction.SetComputeUnitPrice) {
      computeUnitPrice = getSetComputeUnitPriceInstructionDataDecoder().decode(
        ix.data,
      ).microLamports;
      if (computeUnitPrice > cfg.maxComputeUnitPrice) {
        throw new FeeCeilingExceededError(
          `compute unit price ${computeUnitPrice} exceeds ceiling ${cfg.maxComputeUnitPrice}`,
        );
      }
    } else if (kind === ComputeBudgetInstruction.SetComputeUnitLimit) {
      computeUnitLimit = getSetComputeUnitLimitInstructionDataDecoder().decode(
        ix.data,
      ).units;
      if (computeUnitLimit > cfg.maxComputeUnits) {
        throw new FeeCeilingExceededError(
          `compute unit limit ${computeUnitLimit} exceeds ceiling ${cfg.maxComputeUnits}`,
        );
      }
    }
  }

  // Pinned message: byte-equal the platform-compiled message when supplied.
  if (expected.messageBase64) {
    const actual = Buffer.from(tx.messageBytes).toString("base64");
    if (actual !== expected.messageBase64) {
      throw new MessageMismatchError(
        "compiled message does not byte-match the pinned message",
      );
    }
  }

  // Consumer signature must already be present (a non-zero signature).
  const hasConsumerSignature = Object.values(tx.signatures).some(
    (sig) => sig != null && sig.some((b) => b !== 0),
  );
  if (!hasConsumerSignature) {
    throw new MissingSignatureError(
      "no non-zero signature present on the transaction",
    );
  }

  const baseFee = LAMPORTS_PER_SIGNATURE * BigInt(msg.header.numSignerAccounts);
  const priorityFee =
    (computeUnitPrice * BigInt(computeUnitLimit)) / 1_000_000n;
  const estimatedFeeLamports = baseFee + priorityFee;
  if (estimatedFeeLamports > cfg.maxFeeLamportsPerTx) {
    throw new FeeCeilingExceededError(
      `estimated fee ${estimatedFeeLamports} exceeds ceiling ${cfg.maxFeeLamportsPerTx}`,
    );
  }

  return {
    amount: transfer.amount,
    computeUnitPrice,
    computeUnitLimit,
    estimatedFeeLamports,
  };
}

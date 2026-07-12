import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getCompiledTransactionMessageEncoder,
  getTransactionDecoder,
  getTransactionEncoder,
  generateKeyPairSigner,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import { getTransferCheckedInstruction } from "@solana-program/token";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import { getTransferSolInstruction } from "@solana-program/system";
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
  MessageMismatchError,
  MissingSignatureError,
  UnsupportedMintError,
  WrongDecimalsError,
  WrongDestinationError,
} from "./cosign.errors";
import { validateSettlementTransaction } from "./tx-validation";

const USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const BLOCKHASH = "11111111111111111111111111111111" as Blockhash;

let feePayer: KeyPairSigner;
let consumer: KeyPairSigner;
let source: string;
let dest: string;
let otherAddr: string;

beforeAll(async () => {
  feePayer = await generateKeyPairSigner();
  consumer = await generateKeyPairSigner();
  source = (await generateKeyPairSigner()).address;
  dest = (await generateKeyPairSigner()).address;
  otherAddr = (await generateKeyPairSigner()).address;
});

function makeCfg(): RelayerConfig {
  return {
    cluster: "devnet",
    usdcMint: USDC,
    feePayerAddress: feePayer.address,
    programAllowlist: [
      COMPUTE_BUDGET_PROGRAM,
      TOKEN_PROGRAM,
      ASSOCIATED_TOKEN_PROGRAM,
    ],
    maxComputeUnitPrice: 1_000_000n,
    maxComputeUnits: 400_000,
    maxFeeLamportsPerTx: 50_000n,
    perConsumerPaymentsPerHour: 20,
    perConsumerFeeLamportsPerDay: 2_000_000n,
    perMerchantPaymentsPerHour: 500,
    globalFeeLamportsPerDay: 200_000_000n,
    minFeePayerBalanceLamports: 100_000_000n,
  };
}

function transferChecked(opts?: {
  mint?: string;
  destination?: string;
  decimals?: number;
}) {
  return getTransferCheckedInstruction({
    source: address(source),
    mint: address(opts?.mint ?? USDC),
    destination: address(opts?.destination ?? dest),
    authority: consumer,
    amount: 1_000_000n,
    decimals: opts?.decimals ?? 6,
  });
}

function validIxns(): Instruction[] {
  return [
    getSetComputeUnitPriceInstruction({ microLamports: 1000n }),
    getSetComputeUnitLimitInstruction({ units: 200_000 }),
    transferChecked(),
  ];
}

function buildWireTx(
  instructions: readonly Instruction[],
  sign = true,
): string {
  const withIxns = appendTransactionMessageInstructions(
    instructions,
    setTransactionMessageLifetimeUsingBlockhash(
      { blockhash: BLOCKHASH, lastValidBlockHeight: 1000n },
      setTransactionMessageFeePayer(
        feePayer.address,
        createTransactionMessage({ version: 0 }),
      ),
    ),
  );
  const compiled = compileTransaction(withIxns);
  const signatures: Record<string, Uint8Array | null> = {
    ...(compiled.signatures as Record<string, Uint8Array | null>),
  };
  if (sign) {
    for (const key of Object.keys(signatures)) {
      if (key !== feePayer.address) {
        signatures[key] = new Uint8Array(64).fill(9);
      }
    }
  }
  const tx = { messageBytes: compiled.messageBytes, signatures } as never;
  return Buffer.from(getTransactionEncoder().encode(tx)).toString("base64");
}

/** Inject an address-table lookup into an otherwise-valid v0 message. */
function buildWireTxWithAlt(): string {
  const base = buildWireTx(validIxns());
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(base));
  const msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  const withAlt = {
    ...msg,
    addressTableLookups: [
      {
        lookupTableAddress: address(otherAddr),
        readonlyIndexes: [0],
        writableIndexes: [],
      },
    ],
  };
  const newMsgBytes = getCompiledTransactionMessageEncoder().encode(
    withAlt as never,
  );
  const newTx = {
    messageBytes: newMsgBytes,
    signatures: tx.signatures,
  } as never;
  return Buffer.from(getTransactionEncoder().encode(newTx)).toString("base64");
}

describe("validateSettlementTransaction", () => {
  it("accepts a valid TransferChecked to the expected destination", () => {
    const wire = buildWireTx(validIxns());
    const result = validateSettlementTransaction(wire, makeCfg(), {
      settlementAccount: dest,
    });
    expect(result.amount).toBe(1_000_000n);
    expect(result.computeUnitPrice).toBe(1000n);
    expect(result.computeUnitLimit).toBe(200_000);
  });

  it("accepts when the pinned message byte-matches", () => {
    const wire = buildWireTx(validIxns());
    const tx = getTransactionDecoder().decode(getBase64Encoder().encode(wire));
    const messageBase64 = Buffer.from(tx.messageBytes).toString("base64");
    expect(() =>
      validateSettlementTransaction(wire, makeCfg(), {
        settlementAccount: dest,
        messageBase64,
      }),
    ).not.toThrow();
  });

  it("rejects a pinned-message mismatch", () => {
    const wire = buildWireTx(validIxns());
    expect(() =>
      validateSettlementTransaction(wire, makeCfg(), {
        settlementAccount: dest,
        messageBase64: "not-the-pinned-message",
      }),
    ).toThrow(MessageMismatchError);
  });

  it("rejects a disallowed System-transfer instruction (System excluded)", () => {
    const wire = buildWireTx([
      getSetComputeUnitLimitInstruction({ units: 200_000 }),
      getTransferSolInstruction({
        source: consumer,
        destination: address(dest),
        amount: 1n,
      }),
    ]);
    expect(() =>
      validateSettlementTransaction(wire, makeCfg(), {
        settlementAccount: dest,
      }),
    ).toThrow(InstructionNotAllowedError);
  });

  it("rejects the fee payer listed as a writable account", () => {
    const wire = buildWireTx([
      transferChecked(),
      getTransferSolInstruction({
        source: feePayer,
        destination: address(dest),
        amount: 1n,
      }),
    ]);
    expect(() =>
      validateSettlementTransaction(wire, makeCfg(), {
        settlementAccount: dest,
      }),
    ).toThrow(FeePayerWritableError);
  });

  it("rejects a wrong mint", () => {
    const wire = buildWireTx([
      getSetComputeUnitPriceInstruction({ microLamports: 1000n }),
      transferChecked({ mint: otherAddr }),
    ]);
    expect(() =>
      validateSettlementTransaction(wire, makeCfg(), {
        settlementAccount: dest,
      }),
    ).toThrow(UnsupportedMintError);
  });

  it("rejects wrong decimals", () => {
    const wire = buildWireTx([transferChecked({ decimals: 9 })]);
    expect(() =>
      validateSettlementTransaction(wire, makeCfg(), {
        settlementAccount: dest,
      }),
    ).toThrow(WrongDecimalsError);
  });

  it("rejects a wrong destination", () => {
    const wire = buildWireTx(validIxns());
    expect(() =>
      validateSettlementTransaction(wire, makeCfg(), {
        settlementAccount: otherAddr,
      }),
    ).toThrow(WrongDestinationError);
  });

  it("rejects an address-lookup-table message", () => {
    const wire = buildWireTxWithAlt();
    expect(() =>
      validateSettlementTransaction(wire, makeCfg(), {
        settlementAccount: dest,
      }),
    ).toThrow(AddressLookupTableForbiddenError);
  });

  it("rejects compute unit price over the ceiling", () => {
    const wire = buildWireTx([
      getSetComputeUnitPriceInstruction({ microLamports: 1_000_001n }),
      getSetComputeUnitLimitInstruction({ units: 200_000 }),
      transferChecked(),
    ]);
    expect(() =>
      validateSettlementTransaction(wire, makeCfg(), {
        settlementAccount: dest,
      }),
    ).toThrow(FeeCeilingExceededError);
  });

  it("rejects compute unit limit over the ceiling", () => {
    const wire = buildWireTx([
      getSetComputeUnitPriceInstruction({ microLamports: 1000n }),
      getSetComputeUnitLimitInstruction({ units: 400_001 }),
      transferChecked(),
    ]);
    expect(() =>
      validateSettlementTransaction(wire, makeCfg(), {
        settlementAccount: dest,
      }),
    ).toThrow(FeeCeilingExceededError);
  });

  it("rejects a transaction with no Consumer signature", () => {
    const wire = buildWireTx(validIxns(), false);
    expect(() =>
      validateSettlementTransaction(wire, makeCfg(), {
        settlementAccount: dest,
      }),
    ).toThrow(MissingSignatureError);
  });
});

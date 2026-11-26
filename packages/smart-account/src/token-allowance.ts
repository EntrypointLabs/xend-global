import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { instructions, utils } from "@sqds/smart-account";
import type { AccountAddresses } from "./types.js";
import { TOKEN_PROGRAM_ID } from "./programs.js";
import { associatedTokenAddress } from "./spend.js";

export interface TokenAllowanceParams {
  addresses: AccountAddresses;
  policy: PublicKey;
  signers: readonly PublicKey[];
  delegate: PublicKey;
  mint: PublicKey;
  amount: bigint;
  /** Read from the existing policy, preserving its on-chain constraint order. */
  allowedPrograms: readonly PublicKey[];
  /** Shared, explicitly selected Earn forwarder; not an Account signer. */
  forwarderProgram?: PublicKey;
  /** The mint's token program; Token-2022 mints such as USDG need it. */
  tokenProgram?: PublicKey;
  /** Vault instructions run under the same policy call before the approve (SOL wrapping). */
  beforeGrant?: TransactionInstruction[];
  /** Vault instructions run under the same policy call after the revoke (SOL unwrapping). */
  afterRevoke?: TransactionInstruction[];
}

/**
 * The swap compatibility path's Token-only permission, without a policy edit.
 * Compose grant, provider operation and revoke into ONE outer transaction.
 * This does not validate provider instructions or authorize a lending strategy.
 */
export function buildTokenAllowance(params: TokenAllowanceParams): {
  grant: TransactionInstruction;
  revoke: TransactionInstruction;
  source: PublicKey;
} {
  const {
    addresses,
    policy,
    signers,
    delegate,
    mint,
    amount,
    allowedPrograms,
  } = params;
  if (signers.length !== 2 || signers[0]!.equals(signers[1]!)) {
    throw new Error("An allowance requires two distinct Account signers");
  }
  const forwarderAuthority =
    params.forwarderProgram &&
    PublicKey.findProgramAddressSync(
      [Buffer.from("earn"), addresses.vault.toBuffer()],
      params.forwarderProgram,
    )[0];
  if (
    !(
      forwarderAuthority?.equals(delegate) ||
      signers.some((signer) => signer.equals(delegate))
    ) ||
    delegate.equals(addresses.vault)
  ) {
    throw new Error("The allowance delegate must be an approving signer");
  }
  if (amount <= 0n || amount > 0xffffffffffffffffn) {
    throw new Error("Invalid token allowance amount");
  }
  const tokenProgram = params.tokenProgram ?? TOKEN_PROGRAM_ID;
  const constraintOf = (program: PublicKey) => {
    const index = allowedPrograms.findIndex((p) => p.equals(program));
    if (index < 0 || index > 255)
      throw new Error(`Policy does not admit ${program.toBase58()}`);
    return index;
  };
  const source = associatedTokenAddress(addresses.vault, mint, tokenProgram);
  function wrap(inners: TransactionInstruction[]): TransactionInstruction {
    const compiled = utils.instructionsToSynchronousTransactionDetails({
      vaultPda: addresses.vault,
      members: [],
      transaction_instructions: inners,
    });
    return instructions.executePolicyPayloadSync({
      policy,
      accountIndex: 0,
      numSigners: signers.length,
      policyPayload: {
        __kind: "ProgramInteraction",
        fields: [
          {
            instructionConstraintIndices: Uint8Array.from(
              inners.map((ix) => constraintOf(ix.programId)),
            ),
            transactionPayload: {
              __kind: "SyncTransaction",
              fields: [
                { accountIndex: 0, instructions: compiled.instructions },
              ],
            },
          },
        ],
      },
      instruction_accounts: [
        ...signers.map((pubkey) => ({
          pubkey,
          isSigner: true,
          isWritable: false,
        })),
        ...compiled.accounts,
      ],
    });
  }
  const approve = Buffer.alloc(9);
  approve[0] = 4; // SPL Token Approve; integer base units, never a floating amount.
  approve.writeBigUInt64LE(amount, 1);
  return {
    source,
    grant: wrap([
      ...(params.beforeGrant ?? []),
      new TransactionInstruction({
        programId: tokenProgram,
        data: approve,
        keys: [
          { pubkey: source, isSigner: false, isWritable: true },
          { pubkey: delegate, isSigner: false, isWritable: false },
          { pubkey: addresses.vault, isSigner: true, isWritable: true },
        ],
      }),
    ]),
    revoke: wrap([
      new TransactionInstruction({
        programId: tokenProgram,
        data: Buffer.from([5]),
        keys: [
          { pubkey: source, isSigner: false, isWritable: true },
          { pubkey: addresses.vault, isSigner: true, isWritable: true },
        ],
      }),
      ...(params.afterRevoke ?? []),
    ]),
  };
}

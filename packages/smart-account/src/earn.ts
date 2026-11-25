import { Buffer } from "buffer";
import {
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import { associatedTokenAddress } from "./spend.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./programs.js";
import {
  buildTokenAllowance,
  type TokenAllowanceParams,
} from "./token-allowance.js";

export const EARN_USDC = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
);
export const EARN_PROVIDERS = {
  kamino: {
    name: "Kamino",
    program: "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
    receipt: "B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D",
    reserve: "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59",
  },
  jupiter: {
    name: "Jupiter Lend",
    program: "jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9",
    receipt: "9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D",
    reserve: "2vVYHYM8VYnvZqQWpTJSj8o8DBf1wM8pVs3bsTgYZiqJ",
  },
} as const;
export type EarnProviderId = keyof typeof EARN_PROVIDERS;
export type EarnAction = "deposit" | "redeem";
export interface EarnTerms {
  provider: EarnProviderId;
  action: EarnAction;
  amount: bigint;
  minimumOut: bigint;
}
export interface BuildEarnParams
  extends
    EarnTerms,
    Omit<TokenAllowanceParams, "delegate" | "mint" | "amount"> {
  forwarderProgram: PublicKey;
  feePayer: PublicKey;
}
export function earnAuthority(vault: PublicKey, program: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("earn"), vault.toBuffer()],
    program,
  )[0];
}
const pk = (s: string) => new PublicKey(s);
const ro = (pubkey: PublicKey) => ({
  pubkey,
  isSigner: false,
  isWritable: false,
});
const rw = (pubkey: PublicKey) => ({ ...ro(pubkey), isWritable: true });

/** Pinned mainnet receipt-token markets. No borrowing or mutable route supplied by a server. */
export function earnProviderAccounts(
  provider: EarnProviderId,
  action: EarnAction,
  authority: PublicKey,
) {
  const p = EARN_PROVIDERS[provider];
  const receipt = pk(p.receipt);
  const cash = associatedTokenAddress(authority, EARN_USDC, TOKEN_PROGRAM_ID);
  const shares = associatedTokenAddress(authority, receipt, TOKEN_PROGRAM_ID);
  const src = action === "deposit" ? cash : shares,
    dst = action === "deposit" ? shares : cash;
  if (provider === "kamino") {
    const market = pk("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF");
    const ma = PublicKey.findProgramAddressSync(
      [Buffer.from("lma"), market.toBuffer()],
      pk(p.program),
    )[0];
    const reserve = pk(p.reserve),
      supply = pk("Bgq7trRgVMeq33yt235zM2onQ4bRDBsY5EWiTetF4qw6");
    return action === "deposit"
      ? [
          ro(authority),
          rw(reserve),
          ro(market),
          ro(ma),
          ro(EARN_USDC),
          rw(supply),
          rw(receipt),
          rw(src),
          rw(dst),
          ro(TOKEN_PROGRAM_ID),
          ro(TOKEN_PROGRAM_ID),
          ro(SYSVAR_INSTRUCTIONS_PUBKEY),
        ]
      : [
          ro(authority),
          ro(market),
          rw(reserve),
          ro(ma),
          ro(EARN_USDC),
          rw(receipt),
          rw(supply),
          rw(src),
          rw(dst),
          ro(TOKEN_PROGRAM_ID),
          ro(TOKEN_PROGRAM_ID),
          ro(SYSVAR_INSTRUCTIONS_PUBKEY),
        ];
  }
  const admin = pk("5nmGjA4s7ATzpBQXC5RNceRpaJ7pYw2wKsNBWyuSAZV6"),
    lending = pk(p.reserve);
  const supply = pk("94vK29npVbyRHXH63rRcTiSr26SFhrQTzbpNJuhQEDu"),
    position = pk("Hf9gtkM4dpVBahVSzEXSVCAPpKzBsBcns3s8As3z77oF"),
    rate = pk("5pjzT5dFTsXcwixoab1QDLvZQvpYJxJeBphkyfHGn688"),
    pool = pk("BmkUoKMFYBxNSzWXyUjyMJjMAaVz4d8ZnxwwmhDCUXFB"),
    liquidity = pk("7s1da8DduuBFqGra5bJBjpnvL5E9mGzCuMk1Qkh4or2Z"),
    lp = pk("jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC"),
    rewards = pk("5xSPBiD3TibamAnwHDhZABdB4z4F9dcj5PnbteroBTTd");
  const rest = [rw(supply), rw(position), ro(rate), rw(pool)];
  return action === "deposit"
    ? [
        rw(authority),
        rw(src),
        rw(dst),
        ro(EARN_USDC),
        ro(admin),
        rw(lending),
        rw(receipt),
        ...rest,
        rw(liquidity),
        ro(lp),
        ro(rewards),
        ro(TOKEN_PROGRAM_ID),
        ro(ASSOCIATED_TOKEN_PROGRAM_ID),
        ro(SystemProgram.programId),
      ]
    : [
        rw(authority),
        rw(src),
        rw(dst),
        ro(admin),
        rw(lending),
        ro(EARN_USDC),
        rw(receipt),
        ...rest,
        rw(pk("HN1r4VfkDn53xQQfeGDYrNuDKFdemAhZsHYRwBrFhsW")),
        rw(liquidity),
        ro(lp),
        ro(rewards),
        ro(TOKEN_PROGRAM_ID),
        ro(ASSOCIATED_TOKEN_PROGRAM_ID),
        ro(SystemProgram.programId),
      ];
}
function openAta(
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    data: Buffer.from([1]),
    keys: [
      rw(payer),
      rw(associatedTokenAddress(owner, mint, TOKEN_PROGRAM_ID)),
      ro(owner),
      ro(mint),
      ro(SystemProgram.programId),
      ro(TOKEN_PROGRAM_ID),
    ].map((k, i) => ({ ...k, isSigner: i === 0 })),
  });
}
export function buildEarnInstructions(
  params: BuildEarnParams,
): TransactionInstruction[] {
  const {
    provider,
    action,
    amount,
    minimumOut,
    addresses,
    feePayer,
    forwarderProgram,
  } = params;
  if (
    !EARN_PROVIDERS[provider] ||
    !["deposit", "redeem"].includes(action) ||
    minimumOut <= 0n ||
    minimumOut >= 0xffffffffffffffffn
  )
    throw new Error("Invalid Earn terms");
  const authority = earnAuthority(addresses.vault, forwarderProgram),
    receipt = pk(EARN_PROVIDERS[provider].receipt);
  const input = action === "deposit" ? EARN_USDC : receipt,
    output = action === "deposit" ? receipt : EARN_USDC;
  const allowance = buildTokenAllowance({
    ...params,
    delegate: authority,
    mint: input,
  });
  const data = Buffer.alloc(19);
  data[0] = 1;
  data[1] = provider === "kamino" ? 0 : 1;
  data[2] = action === "deposit" ? 0 : 1;
  data.writeBigUInt64LE(amount, 3);
  data.writeBigUInt64LE(minimumOut, 11);
  const forward = new TransactionInstruction({
    programId: forwarderProgram,
    data,
    keys: [
      { ...rw(feePayer), isSigner: true },
      ro(addresses.vault),
      rw(authority),
      ro(EARN_USDC),
      ro(receipt),
      rw(allowance.source),
      rw(associatedTokenAddress(addresses.vault, output, TOKEN_PROGRAM_ID)),
      rw(associatedTokenAddress(authority, input, TOKEN_PROGRAM_ID)),
      rw(associatedTokenAddress(authority, output, TOKEN_PROGRAM_ID)),
      ro(TOKEN_PROGRAM_ID),
      ro(pk(EARN_PROVIDERS[provider].program)),
      ...earnProviderAccounts(provider, action, authority),
    ],
  });
  return [
    openAta(feePayer, addresses.vault, output),
    openAta(feePayer, authority, input),
    openAta(feePayer, authority, output),
    allowance.grant,
    forward,
    allowance.revoke,
  ];
}

import { Buffer } from "buffer";
import {
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import { associatedTokenAddress } from "./spend.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  WRAPPED_SOL_MINT,
} from "./programs.js";
import { TOKEN_ACCOUNT_RENT_LAMPORTS } from "./swap.js";
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

/**
 * Jupiter Lend main-market lending tokens, read from mainnet on 2026-11-25.
 * The phone rebuilds every Earn message from these accounts, so a server can
 * never route a deposit to a market that is not listed here.
 */
export const JUPITER_EARN_ASSETS = {
  USDC: {
    name: "USD Coin",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    token2022: false,
    decimals: 6,
    receipt: "9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D",
    lending: "2vVYHYM8VYnvZqQWpTJSj8o8DBf1wM8pVs3bsTgYZiqJ",
    supply: "94vK29npVbyRHXH63rRcTiSr26SFhrQTzbpNJuhQEDu",
    position: "Hf9gtkM4dpVBahVSzEXSVCAPpKzBsBcns3s8As3z77oF",
    rate: "5pjzT5dFTsXcwixoab1QDLvZQvpYJxJeBphkyfHGn688",
    pool: "BmkUoKMFYBxNSzWXyUjyMJjMAaVz4d8ZnxwwmhDCUXFB",
    rewards: "5xSPBiD3TibamAnwHDhZABdB4z4F9dcj5PnbteroBTTd",
    claim: "HN1r4VfkDn53xQQfeGDYrNuDKFdemAhZsHYRwBrFhsW",
  },
  USDG: {
    name: "Global Dollar",
    mint: "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH",
    token2022: true,
    decimals: 6,
    receipt: "9fvHrYNw1A8Evpcj7X2yy4k4fT7nNHcA9L6UsamNHAif",
    lending: "xRVWEc2J4o5BPxEaiZ6jKyvcNmFovrVuYhuowp9hPM4",
    supply: "G4KAenCBfybnZLtVe4LdNrmEtQoW3x93oTowFJUPSvx6",
    position: "FQgZ6p5sV1HUMs1Aq8eXxR5jC6ak7ZayjU1Ke2yjkGwg",
    rate: "6iHHKAK9Mqjn57CVmWe4szAPyTH8s8pniXSj6vWaKW5r",
    pool: "E1prFSvCtp5ze1hAegjdtN3kQWVoRuSGWLoc8Vj9h4nm",
    rewards: "ChnL2VdEsQkZYbHNMmrdYpmhHtDzTLiG1ca2Vtsap9Vs",
    claim: "AfbHM89oHKXCbHKRZ2G31kgBRuADGyAso7rsyzcqdzDY",
  },
  SOL: {
    name: "Solana",
    mint: "So11111111111111111111111111111111111111112",
    token2022: false,
    decimals: 9,
    receipt: "2uQsyo1fXXQkDtcpXnLofWy88PxcvnfH2L8FPSE62FVU",
    lending: "BeAqbxfrcXmzEYT2Ra62oW2MqkuFDHaCtps47Mzg6Zj3",
    supply: "4Y66HtUEqbbbpZdENGtFdVhUMS3tnagffn3M4do59Nfy",
    position: "4SkEYxmiRgQ4VYyvh9VB4k39M49BpqazyzDUFDzJhXQm",
    rate: "Acvyi9HBGmqh3Exe1N4PjBVyY8fokq2AdC6fSLqV6KSo",
    pool: "5JP5zgYCb9W37QQLgAHRHuinFLrKt87akDY1CgZoTPzr",
    rewards: "CkeQGDRsgMZcCaU8cZEdC2aFAohia4jLzL36RaLcUDsR",
    claim: "6AQGR8zK4KTVZfZ9UZaRzyEL5ynvwVaF5ywVdmtJT24N",
  },
  USDT: {
    name: "Tether USD",
    mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    token2022: false,
    decimals: 6,
    receipt: "Cmn4v2wipYV41dkakDvCgFJpxhtaaKt11NyWV8pjSE8A",
    lending: "F7tLdeF2YZZex9MR8HgGggyFiz7UU2UgUube2tmfwNPE",
    supply: "Enao27EWUV2fv3rUqwknJ1eRaM5aAeN5ijeCrM9tayRX",
    position: "HVPCmWZ1TN4jUpmewkALAsHSFGLJ1YnYcfVjVai3Pcix",
    rate: "6sAbVeSvEfjQGRAGg9W4PAfhB5qNhYiGdx6Fh9uVEsEC",
    pool: "4HTRHjdgy4VSVRcsumuzVFCgWywNhjGsD5oG3kqAt5vo",
    rewards: "AU7sGinWFZkurwrEdQ9Q8qMtgU6W3GNKfCeCnGQKcBeQ",
    claim: "CGgS9fo5ZCFm6weVBotQ7M9qVKuhLrVZnqXH7tee1SZ5",
  },
} as const;
export type EarnAssetId = keyof typeof JUPITER_EARN_ASSETS;

/** Kamino lends USDC only; Jupiter lends every listed asset. */
export function earnAssetsFor(provider: EarnProviderId): EarnAssetId[] {
  return provider === "kamino"
    ? ["USDC"]
    : (Object.keys(JUPITER_EARN_ASSETS) as EarnAssetId[]);
}

export function earnAssetByMint(mint: string): EarnAssetId | null {
  const found = (
    Object.entries(JUPITER_EARN_ASSETS) as [
      EarnAssetId,
      (typeof JUPITER_EARN_ASSETS)[EarnAssetId],
    ][]
  ).find(([, a]) => a.mint === mint);
  return found ? found[0] : null;
}

export function earnAsset(
  provider: EarnProviderId,
  asset: EarnAssetId = "USDC",
) {
  const a = JUPITER_EARN_ASSETS[asset];
  if (!a || !earnAssetsFor(provider).includes(asset))
    throw new Error(`${EARN_PROVIDERS[provider].name} does not lend ${asset}`);
  return {
    id: asset,
    symbol: asset,
    name: a.name,
    decimals: a.decimals,
    mint: new PublicKey(a.mint),
    tokenProgram: a.token2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
    receipt: new PublicKey(
      provider === "kamino" ? EARN_PROVIDERS.kamino.receipt : a.receipt,
    ),
    /** The provider account whose exchange rate prices this asset's receipt. */
    reserve: new PublicKey(
      provider === "kamino" ? EARN_PROVIDERS.kamino.reserve : a.lending,
    ),
  };
}
export type EarnAction = "deposit" | "redeem";
export interface EarnTerms {
  provider: EarnProviderId;
  action: EarnAction;
  /** Jupiter only; Kamino stays USDC. Defaults to USDC. */
  asset?: EarnAssetId;
  amount: bigint;
  minimumOut: bigint;
}
export interface BuildEarnParams
  extends
    EarnTerms,
    Omit<TokenAllowanceParams, "delegate" | "mint" | "amount"> {
  forwarderProgram: PublicKey;
  feePayer: PublicKey;
  /**
   * SOL only: the vault already has its wrapped-SOL account, so the sponsor
   * opens nothing and is owed no rent when the move closes it. Read from the
   * chain by whoever builds the message, phone and backend alike.
   */
  wrappedSolAccountExists?: boolean;
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
  asset: EarnAssetId = "USDC",
) {
  const p = EARN_PROVIDERS[provider];
  const { mint, tokenProgram, receipt } = earnAsset(provider, asset);
  const cash = associatedTokenAddress(authority, mint, tokenProgram);
  const shares = associatedTokenAddress(authority, receipt, tokenProgram);
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
  const j = JUPITER_EARN_ASSETS[asset];
  const admin = pk("5nmGjA4s7ATzpBQXC5RNceRpaJ7pYw2wKsNBWyuSAZV6"),
    lending = pk(j.lending);
  const supply = pk(j.supply),
    position = pk(j.position),
    rate = pk(j.rate),
    pool = pk(j.pool),
    liquidity = pk("7s1da8DduuBFqGra5bJBjpnvL5E9mGzCuMk1Qkh4or2Z"),
    lp = pk("jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC"),
    rewards = pk(j.rewards);
  const rest = [rw(supply), rw(position), ro(rate), rw(pool)];
  return action === "deposit"
    ? [
        rw(authority),
        rw(src),
        rw(dst),
        ro(mint),
        ro(admin),
        rw(lending),
        rw(receipt),
        ...rest,
        rw(liquidity),
        ro(lp),
        ro(rewards),
        ro(tokenProgram),
        ro(ASSOCIATED_TOKEN_PROGRAM_ID),
        ro(SystemProgram.programId),
      ]
    : [
        rw(authority),
        rw(src),
        rw(dst),
        ro(admin),
        rw(lending),
        ro(mint),
        rw(receipt),
        ...rest,
        rw(pk(j.claim)),
        rw(liquidity),
        ro(lp),
        ro(rewards),
        ro(tokenProgram),
        ro(ASSOCIATED_TOKEN_PROGRAM_ID),
        ro(SystemProgram.programId),
      ];
}
function openAta(
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey = TOKEN_PROGRAM_ID,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    data: Buffer.from([1]),
    keys: [
      rw(payer),
      rw(associatedTokenAddress(owner, mint, tokenProgram)),
      ro(owner),
      ro(mint),
      ro(SystemProgram.programId),
      ro(tokenProgram),
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
  const asset = params.asset ?? "USDC";
  const authority = earnAuthority(addresses.vault, forwarderProgram),
    { mint, tokenProgram, receipt } = earnAsset(provider, asset);
  const input = action === "deposit" ? mint : receipt,
    output = action === "deposit" ? receipt : mint;
  // Native SOL lives in the vault's lamports. Wrap exactly the deposit into the
  // vault's wSOL account before the allowance, and close that account after a
  // move so the vault holds plain SOL again. Closing hands the account rent to
  // the vault; when the sponsor opened the account in this transaction the
  // vault repays it in the same policy call, so the vault ends level.
  const sol = mint.equals(WRAPPED_SOL_MINT);
  const wsol = associatedTokenAddress(
    addresses.vault,
    WRAPPED_SOL_MINT,
    TOKEN_PROGRAM_ID,
  );
  const unwrap = sol
    ? [
        new TransactionInstruction({
          programId: TOKEN_PROGRAM_ID,
          data: Buffer.from([9]),
          keys: [
            rw(wsol),
            rw(addresses.vault),
            { ...ro(addresses.vault), isSigner: true },
          ],
        }),
        ...(params.wrappedSolAccountExists
          ? []
          : [
              SystemProgram.transfer({
                fromPubkey: addresses.vault,
                toPubkey: feePayer,
                lamports: TOKEN_ACCOUNT_RENT_LAMPORTS,
              }),
            ]),
      ]
    : [];
  const allowance = buildTokenAllowance({
    ...params,
    delegate: authority,
    mint: input,
    tokenProgram,
    beforeGrant:
      sol && action === "deposit"
        ? [
            SystemProgram.transfer({
              fromPubkey: addresses.vault,
              toPubkey: wsol,
              lamports: amount,
            }),
            new TransactionInstruction({
              programId: TOKEN_PROGRAM_ID,
              data: Buffer.from([17]),
              keys: [rw(wsol)],
            }),
          ]
        : [],
    afterRevoke: unwrap,
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
      ro(mint),
      ro(receipt),
      rw(allowance.source),
      rw(associatedTokenAddress(addresses.vault, output, tokenProgram)),
      rw(associatedTokenAddress(authority, input, tokenProgram)),
      rw(associatedTokenAddress(authority, output, tokenProgram)),
      ro(tokenProgram),
      ro(pk(EARN_PROVIDERS[provider].program)),
      ...earnProviderAccounts(provider, action, authority, asset),
    ],
  });
  return [
    ...(sol && action === "deposit"
      ? [openAta(feePayer, addresses.vault, input)]
      : []),
    openAta(feePayer, addresses.vault, output, tokenProgram),
    openAta(feePayer, authority, input, tokenProgram),
    openAta(feePayer, authority, output, tokenProgram),
    allowance.grant,
    forward,
    allowance.revoke,
  ];
}

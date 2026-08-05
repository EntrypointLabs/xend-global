import { Connection, PublicKey } from "@solana/web3.js";

import type {
  BalancesResponse,
  TokenBalance,
  TransferListResponse,
} from "@/utils/apiClient";
import { getUsdcMint, SOLANA_RPC_URL } from "@/utils/cluster";

/**
 * Reads balances and transfer history straight from Solana RPC.
 *
 * The backend serves these normally, but it must not be the only way to get
 * them. A wallet whose home screen goes blank when our server is unreachable is
 * not a wallet, and it is exactly what a dApp Store reviewer sees on a bad day.
 * Solana RPC is public infrastructure and always up, so these are the floor the
 * app falls back to.
 *
 * Reads only. Anything that spends still goes through the signing path.
 */

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);

let cached: Connection | null = null;
function rpc(): Connection {
  cached ??= new Connection(SOLANA_RPC_URL, "confirmed");
  return cached;
}

interface ParsedTokenAccount {
  account: {
    data: {
      parsed: {
        info: {
          mint: string;
          tokenAmount: { amount: string; decimals: number };
        };
      };
    };
  };
}

/**
 * Every SPL balance the wallet holds, in the same shape the backend returns so
 * callers cannot tell which source served them.
 */
export async function fetchBalancesFromChain(
  owner: string
): Promise<BalancesResponse> {
  const ownerKey = new PublicKey(owner);
  const connection = rpc();

  // Both token programs: a Token-2022 mint is invisible to a TOKEN_PROGRAM_ID
  // query, and reading only the legacy program would silently under-report.
  const [legacy, token2022, slot] = await Promise.all([
    connection.getParsedTokenAccountsByOwner(ownerKey, {
      programId: TOKEN_PROGRAM_ID,
    }),
    connection.getParsedTokenAccountsByOwner(ownerKey, {
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    connection.getSlot(),
  ]);

  const usdcMint = getUsdcMint();
  const tokens: TokenBalance[] = [...legacy.value, ...token2022.value].map(
    (entry) => {
      const info = (entry as unknown as ParsedTokenAccount).account.data.parsed
        .info;
      return {
        mint: info.mint,
        amountRaw: info.tokenAmount.amount,
        decimals: info.tokenAmount.decimals,
        symbol: info.mint === usdcMint ? "USDC" : null,
      };
    }
  );

  // A wallet with no token account yet still has a zero USDC balance to show,
  // otherwise the home screen renders an empty state rather than "$0.00".
  if (!tokens.some((t) => t.mint === usdcMint)) {
    tokens.push({
      mint: usdcMint,
      amountRaw: "0",
      decimals: 6,
      symbol: "USDC",
    });
  }

  return { walletAddress: owner, tokens, fetchedAtSlot: slot };
}

export interface ChainTransfer {
  signature: string;
  /** Seconds since epoch, or null while the block time is still unknown. */
  blockTime: number | null;
  direction: "in" | "out";
  /** Smallest units of the mint. */
  amountRaw: string;
  decimals: number;
  mint: string;
  counterparty: string | null;
  status: "confirmed" | "failed";
}

/**
 * Recent SPL transfers touching the wallet, newest first.
 *
 * Derived by diffing pre- and post-transaction token balances rather than by
 * decoding instructions, so a transfer is picked up however it was routed:
 * directly, through a smart account, or wrapped in someone else's program.
 */
export async function fetchTransfersFromChain(
  owner: string,
  limit = 20
): Promise<ChainTransfer[]> {
  const ownerKey = new PublicKey(owner);
  const connection = rpc();

  const signatures = await connection.getSignaturesForAddress(ownerKey, {
    limit,
  });
  if (signatures.length === 0) return [];

  const parsed = await connection.getParsedTransactions(
    signatures.map((s) => s.signature),
    { maxSupportedTransactionVersion: 0 }
  );

  const transfers: ChainTransfer[] = [];

  parsed.forEach((tx, index) => {
    const entry = signatures[index];
    if (!tx || !entry) return;

    const pre = tx.meta?.preTokenBalances ?? [];
    const post = tx.meta?.postTokenBalances ?? [];

    for (const after of post) {
      if (after.owner !== owner) continue;

      const before = pre.find(
        (b) => b.accountIndex === after.accountIndex && b.owner === owner
      );
      const beforeRaw = BigInt(before?.uiTokenAmount.amount ?? "0");
      const afterRaw = BigInt(after.uiTokenAmount.amount ?? "0");
      const delta = afterRaw - beforeRaw;
      if (delta === 0n) continue;

      // The other side of the transfer is whoever moved the opposite way on the
      // same mint. Absent for mints, burns, and anything with several parties.
      const counterparty =
        post.find(
          (other) =>
            other.owner !== owner &&
            other.mint === after.mint &&
            BigInt(other.uiTokenAmount.amount ?? "0") !==
              BigInt(
                pre.find((b) => b.accountIndex === other.accountIndex)
                  ?.uiTokenAmount.amount ?? "0"
              )
        )?.owner ?? null;

      transfers.push({
        signature: entry.signature,
        blockTime: entry.blockTime ?? null,
        direction: delta > 0n ? "in" : "out",
        amountRaw: (delta > 0n ? delta : -delta).toString(),
        decimals: after.uiTokenAmount.decimals,
        mint: after.mint,
        counterparty,
        status: tx.meta?.err ? "failed" : "confirmed",
      });
    }
  });

  return transfers;
}

/**
 * Chain-derived Activity in the backend's row shape, so the feed renders the
 * same whichever source served it.
 *
 * No cursor: RPC paginates by signature rather than by our row ids, and one
 * page is enough for a fallback. `nextCursor` is null so the infinite query
 * stops cleanly instead of looping.
 */
export async function fetchTransferRowsFromChain(
  owner: string,
  limit = 25
): Promise<TransferListResponse> {
  const transfers = await fetchTransfersFromChain(owner, limit);

  return {
    transfers: transfers.map((t) => {
      const timestamp = new Date((t.blockTime ?? 0) * 1000).toISOString();
      const outbound = t.direction === "out";
      return {
        // The signature is the only stable identity chain data carries, and the
        // feed keys off `id`. A wallet can appear twice in one transaction on
        // different mints, so the mint disambiguates.
        id: `${t.signature}:${t.mint}`,
        direction: outbound ? ("SEND" as const) : ("RECEIVE" as const),
        mint: t.mint,
        amountRaw: t.amountRaw,
        fromAddress: outbound ? owner : (t.counterparty ?? ""),
        toAddress: outbound ? (t.counterparty ?? "") : owner,
        status:
          t.status === "failed" ? ("FAILED" as const) : ("CONFIRMED" as const),
        signature: t.signature,
        memo: null,
        // Chain data cannot tell a merchant Payment from a P2P Send, so
        // everything reads as a transfer rather than guessing wrong.
        kind: "transfer" as const,
        merchantName: null,
        createdAt: timestamp,
        confirmedAt: t.status === "confirmed" ? timestamp : null,
      };
    }),
    nextCursor: null,
  };
}

import { Connection, PublicKey } from '@solana/web3.js';
import type { SignatureStatus, TokenBalance } from './solana-rpc.interface';
import type { WalletAddress } from '../wallet/wallet-provider.interface';

/**
 * Shared helpers used by HeliusAdapter and PublicMainnetAdapter.
 *
 * Both adapters are thin wrappers around `@solana/web3.js` Connection
 * objects — Helius and the public mainnet RPC speak the same JSON-RPC
 * dialect (Helius adds extensions like enhanced webhooks which we use
 * in Phase 2, not here). Keeping the per-method bodies in one place
 * removes drift between primary and fallback, so a fix in one place
 * fixes both.
 *
 * Hard rule (from PLAN.md): use `Connection`, never raw fetch.
 */

/** SPL Token Program ID. Pinned here to avoid a runtime dep on
 *  `@solana/spl-token` for Phase 1 (we only need balance reads; the
 *  prepare path that needs `createAssociatedTokenAccountInstruction`
 *  lives in Phase 1 Task 4, separate executor). */
export const TOKEN_PROGRAM_ID = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
);

/** Token-2022 program (USDC and most modern mints can use either). */
export const TOKEN_2022_PROGRAM_ID = new PublicKey(
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
);

export async function getRecentBlockhashViaConnection(
  conn: Connection,
): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  // `getLatestBlockhash` is the modern method; `getRecentBlockhash` is
  // deprecated on the cluster. We keep the interface name for the
  // domain-level seam but call the current RPC under the hood.
  const { blockhash, lastValidBlockHeight } =
    await conn.getLatestBlockhash('confirmed');
  return { blockhash, lastValidBlockHeight };
}

export async function getTokenBalancesViaConnection(
  conn: Connection,
  owner: WalletAddress,
): Promise<TokenBalance[]> {
  const ownerPk = new PublicKey(owner);
  // Both classic SPL Token and Token-2022 can hold balances for the
  // wallet; we query both program IDs and concatenate so the Balance
  // view sums correctly per spec §5.5.
  const [classic, t2022] = await Promise.all([
    conn.getParsedTokenAccountsByOwner(
      ownerPk,
      { programId: TOKEN_PROGRAM_ID },
      'confirmed',
    ),
    conn
      .getParsedTokenAccountsByOwner(
        ownerPk,
        { programId: TOKEN_2022_PROGRAM_ID },
        'confirmed',
      )
      .catch(() => ({ value: [] as Array<unknown> })),
  ]);

  const collect = (
    accounts: Awaited<
      ReturnType<Connection['getParsedTokenAccountsByOwner']>
    >['value'],
  ): TokenBalance[] =>
    accounts.map((acct) => {
      // The parsed shape is:
      //   account.data.parsed.info = { mint, owner, tokenAmount: { amount, decimals, uiAmount, uiAmountString } }
      const info = (acct.account.data as { parsed: { info: unknown } }).parsed
        .info as {
        mint: string;
        tokenAmount: { amount: string; decimals: number };
      };
      return {
        mint: info.mint,
        amountRaw: BigInt(info.tokenAmount.amount),
        decimals: info.tokenAmount.decimals,
      };
    });

  return [
    ...collect(classic.value),
    ...collect(t2022.value as typeof classic.value),
  ];
}

export async function sendRawTransactionViaConnection(
  conn: Connection,
  signedTxBase64: string,
): Promise<string> {
  // The signed transaction comes from the device (Privy SDK) as base64
  // of the fully-serialized v0 transaction (signatures + message). We
  // submit and let the cluster dedupe; idempotency on the same blockhash
  // is guaranteed by Solana itself.
  const raw = Buffer.from(signedTxBase64, 'base64');
  return await conn.sendRawTransaction(raw, {
    // We rely on the prepare/submit split for retries; skip the SDK's
    // preflight to keep the latency budget tight (spec §10 perf budget).
    skipPreflight: false,
    maxRetries: 0,
  });
}

export async function getSignatureStatusesViaConnection(
  conn: Connection,
  signatures: string[],
): Promise<SignatureStatus[]> {
  if (signatures.length === 0) return [];
  const res = await conn.getSignatureStatuses(signatures, {
    searchTransactionHistory: true,
  });
  return signatures.map((sig, i) => {
    const value = res.value[i];
    if (!value) {
      return {
        signature: sig,
        slot: null,
        confirmationStatus: null,
        err: null,
      };
    }
    return {
      signature: sig,
      slot: value.slot != null ? BigInt(value.slot) : null,
      confirmationStatus: value.confirmationStatus ?? null,
      err: value.err ?? null,
    };
  });
}

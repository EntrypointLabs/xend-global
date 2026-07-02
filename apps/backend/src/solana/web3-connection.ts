import {
  Connection,
  ParsedInstruction,
  ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
  PublicKey,
} from '@solana/web3.js';
import type {
  ConfirmedTransferEvent,
  SignatureStatus,
  TokenBalance,
} from './solana-rpc.interface';
import type { WalletAddress } from '../wallet/wallet-provider.interface';

/**
 * Shared helpers used by HeliusAdapter and PublicMainnetAdapter.
 *
 * Both adapters are thin wrappers around `@solana/web3.js` Connection
 * objects — Helius and the public mainnet RPC speak the same JSON-RPC
 * dialect. Keeping the per-method bodies in one place removes drift
 * between primary and fallback, so a fix in one place fixes both. Use
 * `Connection`, never raw fetch.
 */

/** SPL Token Program ID. Pinned here to avoid a runtime dep on
 *  `@solana/spl-token` (we only need balance reads). */
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
  // wallet; query both program IDs and concatenate so the Balance view
  // sums correctly.
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
    // The prepare/submit split owns retries, so keep the SDK's own retry
    // count at zero to keep the latency budget tight.
    skipPreflight: false,
    maxRetries: 0,
  });
}

export async function accountExistsViaConnection(
  conn: Connection,
  address: WalletAddress,
): Promise<boolean> {
  // `getAccountInfo` returns null when the account does not exist on
  // chain. We pass commitment 'confirmed' to match the rest of the
  // shared connection's defaults (avoids reading a slot that may not
  // yet be observable by the next prepare call).
  const info = await conn.getAccountInfo(new PublicKey(address), 'confirmed');
  return info !== null;
}

/**
 * Async iterable over confirmed SPL token transfers for `owner` since
 * `sinceSlot`. Walks `getSignaturesForAddress` 1000 at a time (Helius
 * + public RPC both honour this) and decodes each tx via
 * `getParsedTransaction`. Filters to SPL token transfer instructions
 * for the wallet's ATAs.
 *
 * Cluster-agnostic: works on any standard Solana RPC because it uses the
 * JSON-RPC parsed shape, not Helius's enhanced-transactions endpoint,
 * which gives automatic public-RPC fallback.
 *
 * Used by the boot-time replay in ReconcilerService.onModuleInit and as
 * the dropped-webhook safety net. NOT used on the webhook hot path — the
 * webhook delivers the same data with sub-second latency.
 */
export async function* streamConfirmedTransfersViaConnection(
  conn: Connection,
  owner: WalletAddress,
  sinceSlot: bigint,
): AsyncGenerator<ConfirmedTransferEvent, void, void> {
  const ownerPk = new PublicKey(owner);
  const PAGE = 1000;
  let before: string | undefined = undefined;
  // We collect newest-first from getSignaturesForAddress, then yield
  // oldest-first so downstream UPSERTs land in chain order (handy for
  // tailer_state.last_indexed_slot accumulation).
  const collected: { signature: string; slot: number }[] = [];

  // Stop walking when we pass below the sinceSlot bookmark; Helius's
  // `until` param is a signature, not a slot, so we filter manually.
  // The lower bound is inclusive of the bookmark slot itself: a second
  // confirmed transfer landing in the same slot as an already-indexed
  // one (whose webhook was lost) must still be re-examined on replay.
  // Re-emitting already-indexed same-slot signatures is harmless — the
  // UPSERT's ON CONFLICT(signature) collapses the duplicate.
  for (;;) {
    const page = await conn.getSignaturesForAddress(
      ownerPk,
      { before, limit: PAGE },
      'confirmed',
    );
    if (page.length === 0) break;
    let hitBookmark = false;
    for (const entry of page) {
      if (BigInt(entry.slot) < sinceSlot) {
        hitBookmark = true;
        continue;
      }
      collected.push({ signature: entry.signature, slot: entry.slot });
    }
    if (hitBookmark || page.length < PAGE) break;
    before = page[page.length - 1].signature;
  }

  // Now process oldest-first.
  collected.reverse();

  for (const { signature } of collected) {
    let tx: ParsedTransactionWithMeta | null = null;
    try {
      tx = await conn.getParsedTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
    } catch {
      // Skip on transient parse failures — the reconciliation poll +
      // next replay will pick them up.
      continue;
    }
    if (!tx || tx.meta?.err) continue;
    for (const evt of extractTokenTransfers(tx, owner)) {
      yield evt;
    }
  }
}

/**
 * Pull SPL token transfer events from a parsed transaction. Inspects
 * top-level + inner instructions for `spl-token`'s `transferChecked`
 * and `transfer` variants. Returns events where the owner participates
 * as sender OR receiver.
 *
 * `mint` is resolved from the parsed instruction's `mint` field for
 * `transferChecked` and from the SOURCE token account's parsed account
 * info for plain `transfer`. If neither is available (rare), the event
 * is skipped.
 */
function extractTokenTransfers(
  tx: ParsedTransactionWithMeta,
  owner: WalletAddress,
): ConfirmedTransferEvent[] {
  if (!tx.blockTime) return [];
  const slot = BigInt(tx.slot);
  const confirmedAt = new Date(tx.blockTime * 1000);
  const signature = tx.transaction.signatures[0] ?? '';

  // Build a map of token account pubkey -> { owner, mint } from
  // pre/post token balances. Used to translate raw account keys (which
  // are the ATAs, not the wallet owners) back to wallet owners for the
  // owner-match check.
  const accountOwners = new Map<string, { owner: string; mint: string }>();
  const keys = tx.transaction.message.accountKeys;
  for (const bal of tx.meta?.preTokenBalances ?? []) {
    const acct = keys[bal.accountIndex]?.pubkey.toBase58();
    if (acct && bal.owner) {
      accountOwners.set(acct, { owner: bal.owner, mint: bal.mint });
    }
  }
  for (const bal of tx.meta?.postTokenBalances ?? []) {
    const acct = keys[bal.accountIndex]?.pubkey.toBase58();
    if (acct && bal.owner) {
      accountOwners.set(acct, { owner: bal.owner, mint: bal.mint });
    }
  }

  const events: ConfirmedTransferEvent[] = [];
  const allInstructions: (ParsedInstruction | PartiallyDecodedInstruction)[] =
    [];
  for (const ix of tx.transaction.message.instructions) {
    allInstructions.push(ix);
  }
  for (const inner of tx.meta?.innerInstructions ?? []) {
    for (const ix of inner.instructions) {
      allInstructions.push(ix);
    }
  }

  for (const ix of allInstructions) {
    if (!('parsed' in ix)) continue;
    const parsed = ix.parsed as
      | {
          type: string;
          info: {
            source?: string;
            destination?: string;
            authority?: string;
            mint?: string;
            tokenAmount?: { amount: string };
            amount?: string;
          };
        }
      | undefined;
    if (!parsed) continue;
    if (parsed.type !== 'transfer' && parsed.type !== 'transferChecked') {
      continue;
    }
    if (ix.programId.toBase58() !== TOKEN_PROGRAM_ID.toBase58()) continue;

    const sourceAcct = parsed.info.source;
    const destAcct = parsed.info.destination;
    if (!sourceAcct || !destAcct) continue;

    const sourceMeta = accountOwners.get(sourceAcct);
    const destMeta = accountOwners.get(destAcct);
    const fromOwner = sourceMeta?.owner;
    const toOwner = destMeta?.owner;
    if (!fromOwner || !toOwner) continue;
    if (fromOwner !== owner && toOwner !== owner) continue;

    const mint = parsed.info.mint ?? sourceMeta?.mint ?? destMeta?.mint;
    if (!mint) continue;
    const amountStr =
      parsed.info.tokenAmount?.amount ?? parsed.info.amount ?? '0';

    events.push({
      signature,
      slot,
      mint,
      amountRaw: BigInt(amountStr),
      fromAddress: fromOwner,
      toAddress: toOwner,
      confirmedAt,
    });
  }

  return events;
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

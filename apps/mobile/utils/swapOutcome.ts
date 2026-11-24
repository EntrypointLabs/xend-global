import { WRAPPED_SOL_MINT } from "@/utils/swap";

interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
}

/** The parts of a confirmed transaction that say how balances moved. */
export interface BalanceChanges {
  /** Every account the transaction touched, lookup-table ones included. */
  accountKeys: string[];
  preBalances: number[];
  postBalances: number[];
  preTokenBalances: TokenBalance[];
  postTokenBalances: TokenBalance[];
}

/**
 * How much of `outputMint` reached the vault in a confirmed swap, in raw
 * units, or null when it cannot be told.
 *
 * SOL can arrive two ways: into a wrapped SOL account the vault keeps, or
 * through one opened and closed within the swap, which leaves it as plain
 * SOL. The vault's native balance is counted for SOL so both are covered;
 * the rent such an account takes and gives back nets out within the swap.
 *
 * A wrapped account the vault already had is closed by the swap too, and its
 * rent comes back to the vault with the proceeds. That rent was the
 * Account's all along, not something the swap bought, so it is taken off.
 */
export function receivedBySwap(
  changes: BalanceChanges,
  vault: string,
  outputMint: string
): string | null {
  const held = (balances: TokenBalance[]) =>
    balances
      .filter((b) => b.owner === vault && b.mint === outputMint)
      .reduce((total, b) => total + BigInt(b.uiTokenAmount.amount), 0n);

  let received =
    held(changes.postTokenBalances) - held(changes.preTokenBalances);
  if (outputMint === WRAPPED_SOL_MINT) {
    const index = changes.accountKeys.indexOf(vault);
    if (index >= 0) {
      received += BigInt(
        changes.postBalances[index] - changes.preBalances[index]
      );
    }
    const stillOpen = new Set(
      changes.postTokenBalances.map((b) => b.accountIndex)
    );
    for (const closed of changes.preTokenBalances) {
      if (
        closed.owner !== vault ||
        closed.mint !== WRAPPED_SOL_MINT ||
        stillOpen.has(closed.accountIndex)
      ) {
        continue;
      }
      const lamports = BigInt(changes.preBalances[closed.accountIndex]);
      received -= lamports - BigInt(closed.uiTokenAmount.amount);
    }
  }
  return received > 0n ? received.toString() : null;
}

import { WRAPPED_SOL_MINT } from "@/utils/swap";

interface TokenBalance {
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
  }
  return received > 0n ? received.toString() : null;
}

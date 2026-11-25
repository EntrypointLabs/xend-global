import type {
  ProvisioningChain,
  SettingsState,
  SquadsAccountRow,
} from './account.interface';

/**
 * Whether a change already waiting on an Account leaves room for another.
 *
 * Changes that only rewrite a policy, the Spending Limit and Swap, can wait
 * side by side: each holds its own index and its own time lock, and landing
 * one leaves the other intact. A change to the signer set is different. When
 * it lands the program cancels every other change still waiting, so it has to
 * land last, and nothing new may be staged behind it. Both facts are pinned
 * against the deployed program in the smart-account package.
 */
export type OverlapNeed =
  /** The other change only has to hold its index on chain. */
  | 'proposed'
  /** The other change has to be approved, so its time lock is running. */
  | 'approved';

export type OverlapBlocker = 'being-set-up' | 'not-approved';

/**
 * Why `index` stops a new change starting, or null when it does not.
 *
 * A change that is staged here but not yet proposed has not taken its index,
 * so a second change staged now would claim the same one. One the chain has
 * settled, or that a signer change has cancelled, is no longer in the way
 * even if nothing has cleared it from the Account yet.
 */
export async function overlapBlocker(
  chain: ProvisioningChain,
  account: SquadsAccountRow,
  settings: SettingsState,
  index: string | bigint | null | undefined,
  need: OverlapNeed,
): Promise<OverlapBlocker | null> {
  if (index === null || index === undefined || index === '') return null;
  const changeIndex = BigInt(index);
  if (changeIndex <= (settings.staleTransactionIndex ?? 0n)) return null;

  const proposal = await chain.readProposal(
    account.settingsAddress,
    changeIndex,
  );
  if (!proposal) return 'being-set-up';
  if (proposal.settled) return null;
  if (need === 'approved' && proposal.status !== 'Approved') {
    return 'not-approved';
  }
  return null;
}

/** Whether the change at `index` is still waiting to land. */
export async function stillWaiting(
  chain: ProvisioningChain,
  account: SquadsAccountRow,
  settings: SettingsState,
  index: string | bigint | null | undefined,
): Promise<{ executableAt: Date | null } | null> {
  if (index === null || index === undefined || index === '') return null;
  const changeIndex = BigInt(index);
  if (changeIndex <= (settings.staleTransactionIndex ?? 0n)) return null;

  const proposal = await chain.readProposal(
    account.settingsAddress,
    changeIndex,
  );
  if (!proposal || proposal.settled) return null;
  return {
    executableAt:
      proposal.status === 'Approved' && proposal.statusTimestamp !== null
        ? new Date(
            (Number(proposal.statusTimestamp) + settings.timeLockSeconds) *
              1000,
          )
        : null,
  };
}

export const OVERLAP_MESSAGE: Record<OverlapBlocker, string> = {
  'being-set-up':
    'another change to this Account is still being set up; finish it first',
  'not-approved':
    'another change to this Account has not been approved yet; finish or reject it first',
};

/** A key change is waiting, and anything staged behind it would be cancelled. */
export const KEY_CHANGE_WAITING =
  'a change to the keys on this Account is waiting; this can start once it lands';

import { useMemo } from "react";

import { useTransfersInfinite } from "@/hooks/useTransfers";
import { useWalletAddress } from "@/hooks/useWalletAddress";
import { recentRecipientsFrom } from "@/utils/recentRecipients";

export type { RecentRecipient } from "@/utils/recentRecipients";

/**
 * Recent recipients, derived from Activity rather than kept as a list of their
 * own.
 *
 * Deliberately not a second copy in local storage. The feed already records
 * every send, and a stored copy would be one more thing to write on every send,
 * to scope per user, to prune, and to keep honest when a send fails. It would
 * also start empty on a device the Consumer restored onto, where the history is
 * right there and correct.
 *
 * The cost is that this sees only what Activity has loaded, so it reflects the
 * first page until the Consumer scrolls further back. That is the right way
 * round: a recipient far enough down the feed to be unloaded is not a recent
 * one.
 */
export function useRecentRecipients(
  options: { exclude?: readonly string[]; limit?: number } = {}
) {
  const { exclude, limit = 5 } = options;
  const { data, isLoading } = useTransfersInfinite();
  const own = useWalletAddress();

  const excluded = useMemo(
    () => new Set([...(exclude ?? []), ...(own ? [own] : [])]),
    [exclude, own]
  );

  const recipients = useMemo(
    () =>
      recentRecipientsFrom(
        data?.pages.flatMap((page) => page.transfers) ?? [],
        excluded,
        limit
      ),
    [data, excluded, limit]
  );

  return { recipients, isLoading };
}

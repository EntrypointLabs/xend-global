import type { QueryClient } from "@tanstack/react-query";

type TransferLike = { id: string; status?: string | null };
type TransferPage = { transfers?: TransferLike[] };

/**
 * The newest row in whichever transfers query just landed: the Activity feed
 * (an infinite query, newest page first) or the one-row head poll.
 */
function newestRow(data: unknown): TransferLike | undefined {
  if (!data || typeof data !== "object") return undefined;
  const pages = (data as { pages?: TransferPage[] }).pages;
  const page = Array.isArray(pages) ? pages[0] : (data as TransferPage);
  return page?.transfers?.[0];
}

/**
 * Refetches the balance the moment any transfers query shows a newest row it
 * has not shown before, whichever query got there first.
 *
 * Activity and Home read the same money from two endpoints. The feed refetches
 * on its own schedule (opening the tab, coming back to the app), so it could
 * show an arrival up to a full head-poll interval before anything told the
 * balance, and the two screens disagreed. Watching the cache rather than one
 * hook means every path that learns about a transfer moves the balance too.
 *
 * Keyed on id and status so a transfer settling from PENDING to CONFIRMED
 * counts: that is when the money actually moves. Older pages loading never
 * change the newest row, so scrolling the feed costs nothing.
 *
 * Returns the unsubscribe.
 */
export function watchTransfersForBalance(queryClient: QueryClient) {
  let lastKey: string | null | undefined;

  return queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success") return;
    if (event.query.queryKey[0] !== "transfers") return;

    const head = newestRow(event.query.state.data);
    const key = head ? `${head.id}:${head.status ?? ""}` : null;
    const firstLook = lastKey === undefined;
    if (key === lastKey) return;
    lastKey = key;
    if (firstLook) return;

    void queryClient.invalidateQueries({ queryKey: ["balances"] });
  });
}

import type { InfiniteData, QueryClient } from "@tanstack/react-query";

import type { TransferListResponse } from "@/utils/apiClient";

/**
 * Writes a send's outcome into the cached feed the moment this phone learns
 * it, so the row turns Sent with the toast rather than after the refetch the
 * toast does not wait for.
 */
export function settleTransferInFeed(
  queryClient: QueryClient,
  transferId: string,
  status: "CONFIRMED" | "FAILED"
) {
  const settle = (list: TransferListResponse): TransferListResponse => ({
    ...list,
    transfers: list.transfers.map((row) =>
      row.id === transferId && row.status === "PENDING"
        ? { ...row, status }
        : row
    ),
  });
  queryClient.setQueriesData<
    InfiniteData<TransferListResponse> | TransferListResponse
  >({ queryKey: ["transfers"] }, (data) => {
    if (!data) return data;
    if ("pages" in data) return { ...data, pages: data.pages.map(settle) };
    return settle(data);
  });
}

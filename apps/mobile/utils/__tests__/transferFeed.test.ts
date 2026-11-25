import { QueryClient, type InfiniteData } from "@tanstack/react-query";

import type { TransferListResponse, TransferRow } from "@/utils/apiClient";
import { settleTransferInFeed } from "@/utils/transferFeed";

function row(id: string, status: TransferRow["status"]): TransferRow {
  return {
    id,
    direction: "SEND",
    mint: "So11111111111111111111111111111111111111112",
    amountRaw: "110000000",
    fromAddress: "vault",
    toAddress: "recipient",
    status,
    signature: null,
    memo: null,
    kind: "transfer",
    merchantName: null,
  } as TransferRow;
}

function page(...transfers: TransferRow[]): TransferListResponse {
  return { transfers, nextCursor: null } as TransferListResponse;
}

describe("settleTransferInFeed", () => {
  it("turns the sent row Sent in the feed and the head at once", () => {
    const client = new QueryClient();
    client.setQueryData<InfiniteData<TransferListResponse>>(
      ["transfers", "u"],
      {
        pages: [page(row("t1", "PENDING"), row("t0", "CONFIRMED"))],
        pageParams: [undefined],
      }
    );
    client.setQueryData(["transfers", "head", "u"], page(row("t1", "PENDING")));

    settleTransferInFeed(client, "t1", "CONFIRMED");

    const feed = client.getQueryData<InfiniteData<TransferListResponse>>([
      "transfers",
      "u",
    ]);
    expect(feed?.pages[0].transfers.map((t) => t.status)).toEqual([
      "CONFIRMED",
      "CONFIRMED",
    ]);
    const head = client.getQueryData<TransferListResponse>([
      "transfers",
      "head",
      "u",
    ]);
    expect(head?.transfers[0].status).toBe("CONFIRMED");
  });

  it("leaves a row the feed already settled alone", () => {
    const client = new QueryClient();
    client.setQueryData(["transfers", "head", "u"], page(row("t1", "FAILED")));

    settleTransferInFeed(client, "t1", "CONFIRMED");

    const head = client.getQueryData<TransferListResponse>([
      "transfers",
      "head",
      "u",
    ]);
    expect(head?.transfers[0].status).toBe("FAILED");
  });
});

import { QueryClient, QueryObserver } from "@tanstack/react-query";

import { watchTransfersForBalance } from "@/utils/balanceFollowsActivity";

const USER = "user-1";

function row(id: string, status = "CONFIRMED") {
  return { id, status };
}

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const balanceFetch = jest.fn().mockResolvedValue({ tokens: [] });
  const observer = new QueryObserver(queryClient, {
    queryKey: ["balances", USER],
    queryFn: balanceFetch,
    staleTime: 30_000,
  });
  const unsubscribeObserver = observer.subscribe(() => {});
  const unwatch = watchTransfersForBalance(queryClient);

  const feed = (...transfers: ReturnType<typeof row>[]) =>
    queryClient.fetchQuery({
      queryKey: ["transfers", USER],
      queryFn: () => ({ transfers }),
    });
  const feedPages = (...pages: ReturnType<typeof row>[][]) =>
    queryClient.fetchQuery({
      queryKey: ["transfers", USER],
      queryFn: () => ({
        pages: pages.map((transfers) => ({ transfers })),
        pageParams: [],
      }),
    });
  const head = (...transfers: ReturnType<typeof row>[]) =>
    queryClient.fetchQuery({
      queryKey: ["transfers", "head", USER],
      queryFn: () => ({ transfers }),
    });
  const balanceFetching = () =>
    queryClient.getQueryState(["balances", USER])?.fetchStatus === "fetching";

  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    balanceFetch.mockClear();
  };

  return {
    queryClient,
    balanceFetch,
    feed,
    feedPages,
    head,
    balanceFetching,
    settle,
    cleanup: () => {
      unwatch();
      unsubscribeObserver();
      queryClient.clear();
    },
  };
}

describe("watchTransfersForBalance", () => {
  it("refetches the balance in the same tick the feed shows a new transfer", async () => {
    const t = setup();
    await t.head(row("a"));
    await t.settle();

    await t.feed(row("b"), row("a"));

    expect(t.balanceFetching()).toBe(true);
    expect(t.balanceFetch).toHaveBeenCalledTimes(1);
    t.cleanup();
  });

  it("refetches when the head poll sees a new transfer", async () => {
    const t = setup();
    await t.feed(row("a"));
    await t.settle();

    await t.head(row("b"));

    expect(t.balanceFetch).toHaveBeenCalledTimes(1);
    t.cleanup();
  });

  it("refetches when an outgoing send settles from pending to confirmed", async () => {
    const t = setup();
    await t.feed(row("a"));
    await t.settle();

    await t.feed(row("send", "PENDING"), row("a"));
    await t.settle();
    await t.head(row("send", "CONFIRMED"));

    expect(t.balanceFetch).toHaveBeenCalledTimes(1);
    t.cleanup();
  });

  it("does not refetch twice when the second query catches up to the first", async () => {
    const t = setup();
    await t.head(row("a"));
    await t.settle();

    await t.head(row("b"));
    await t.settle();
    await t.feed(row("b"), row("a"));

    expect(t.balanceFetch).not.toHaveBeenCalled();
    t.cleanup();
  });

  it("ignores the first look and older pages loading", async () => {
    const t = setup();
    await t.feedPages([row("b"), row("a")]);
    await t.settle();
    expect(t.balanceFetch).not.toHaveBeenCalled();

    await t.feedPages([row("b"), row("a")], [row("old")]);

    expect(t.balanceFetch).not.toHaveBeenCalled();
    t.cleanup();
  });

  it("counts the first transfer into an empty account", async () => {
    const t = setup();
    await t.head();
    await t.settle();

    await t.head(row("first"));

    expect(t.balanceFetch).toHaveBeenCalledTimes(1);
    t.cleanup();
  });
});

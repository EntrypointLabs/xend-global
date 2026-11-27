import { afterEach, describe, expect, it, vi } from "vitest";
import { checkPayoutFile, storeSites } from "./payoutFile";

const WALLET = "4yrim3y4svgpp3bEZjrDrC2UihXDdQH3fiWdS1i45zkH";

function serve(response: Response | Error) {
  const fetchMock = vi.fn(() =>
    response instanceof Error
      ? Promise.reject(response)
      : Promise.resolve(response),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe("storeSites", () => {
  it("keeps live https sites and drops local ones", () => {
    expect(
      storeSites([
        "https://shop.prydd.co",
        "https://prydd-shop.vercel.app/",
        "http://localhost:3100",
        "https://app.localhost",
        "http://plain.example",
        "not a url",
        "https://shop.prydd.co",
      ]),
    ).toEqual(["https://shop.prydd.co", "https://prydd-shop.vercel.app"]);
  });

  it("has nothing to check without origins", () => {
    expect(storeSites(null)).toEqual([]);
  });
});

describe("checkPayoutFile", () => {
  it("matches the wallet published for the network", async () => {
    const fetchMock = serve(json({ payoutWallets: { mainnet: WALLET } }));
    await expect(
      checkPayoutFile("https://shop.prydd.co", "mainnet", WALLET),
    ).resolves.toEqual({ state: "match" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://shop.prydd.co/.well-known/prydd.json",
      expect.objectContaining({ credentials: "omit" }),
    );
  });

  it("reads mainnet-beta as mainnet", async () => {
    serve(json({ payoutWallets: { mainnet: WALLET } }));
    await expect(
      checkPayoutFile("https://shop.prydd.co", "mainnet-beta", WALLET),
    ).resolves.toEqual({ state: "match" });
  });

  it("reports a different wallet", async () => {
    serve(
      json({ payoutWallets: { mainnet: "Other1111111111111111111111111" } }),
    );
    await expect(
      checkPayoutFile("https://shop.prydd.co", "mainnet", WALLET),
    ).resolves.toEqual({
      state: "mismatch",
      published: "Other1111111111111111111111111",
    });
  });

  it("reports a file with no wallet for this network as missing", async () => {
    serve(json({ payoutWallets: { devnet: WALLET } }));
    await expect(
      checkPayoutFile("https://shop.prydd.co", "mainnet", WALLET),
    ).resolves.toEqual({ state: "missing" });
  });

  it("reports a missing file as missing", async () => {
    serve(json({}, 404));
    await expect(
      checkPayoutFile("https://shop.prydd.co", "mainnet", WALLET),
    ).resolves.toEqual({ state: "missing" });
  });

  it("reports an unreachable site as missing", async () => {
    serve(new TypeError("Failed to fetch"));
    await expect(
      checkPayoutFile("https://shop.prydd.co", "mainnet", WALLET),
    ).resolves.toEqual({ state: "missing" });
  });
});

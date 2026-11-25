import { fetchPayoutWallet, storeOrigin } from "@/utils/merchantPayoutWallet";

const WALLET = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const realFetch = global.fetch;

function respond(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

afterEach(() => {
  global.fetch = realFetch;
});

describe("storeOrigin", () => {
  it("keeps an https origin", () => {
    expect(storeOrigin("https://shop.example/checkout")).toBe(
      "https://shop.example"
    );
  });

  it("refuses anything that is not https", () => {
    expect(storeOrigin("http://shop.example")).toBeNull();
    expect(storeOrigin("not a url")).toBeNull();
    expect(storeOrigin(null)).toBeNull();
  });
});

describe("fetchPayoutWallet", () => {
  it("reads the wallet for this network from the store site", async () => {
    respond(200, { payoutWallets: { devnet: WALLET } });
    await expect(
      fetchPayoutWallet("https://shop.example", { cluster: "devnet" })
    ).resolves.toBe(WALLET);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://shop.example/.well-known/prydd.json",
      expect.anything()
    );
  });

  it("refuses when the store has published nothing", async () => {
    respond(404, {});
    await expect(
      fetchPayoutWallet("https://shop.example", { cluster: "devnet" })
    ).rejects.toThrow("status 404");
  });

  it("refuses when the store has no wallet for this network", async () => {
    respond(200, { payoutWallets: { mainnet: WALLET } });
    await expect(
      fetchPayoutWallet("https://shop.example", { cluster: "devnet" })
    ).rejects.toThrow("no wallet for devnet");
  });

  it("refuses a value that is not an address", async () => {
    respond(200, { payoutWallets: { devnet: "nope" } });
    await expect(
      fetchPayoutWallet("https://shop.example", { cluster: "devnet" })
    ).rejects.toThrow("not an address");
  });
});

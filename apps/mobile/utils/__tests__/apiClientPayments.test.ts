import { apiClient } from "@/utils/apiClient";

jest.mock("@/utils/errors", () => ({
  handleError: jest.fn(),
  ErrorCode: {},
  ENTRY_SESSION_SEND_MESSAGE: "",
}));
jest.mock("@/utils/toast", () => ({ showToast: jest.fn() }));
jest.mock("@/utils/storage/authStorage", () => ({
  AuthStorage: { getToken: jest.fn().mockResolvedValue("test-token") },
}));
jest.mock("@/utils/devSeed", () => ({ SEED_DEMO: false }));

describe("phone Payment reads", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("lists pending approvals with a bodyless default GET", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ payments: [] }),
    });
    global.fetch = fetchMock;
    await expect(apiClient.listAwaitingPayments()).resolves.toEqual([]);
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty("body");
  });

  it("polls Payment status with a bodyless default GET", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "succeeded" }),
    });
    global.fetch = fetchMock;
    await expect(apiClient.paymentStatus("pi_test")).resolves.toBe("succeeded");
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty("body");
  });
});

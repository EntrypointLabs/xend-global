import {
  deletePendingPaymentSubmission,
  loadPendingPaymentSubmissions,
  savePendingPaymentSubmission,
} from "@/utils/pendingPaymentSubmissions";
import type { AwaitingPayment } from "@/utils/apiClient";

const mockAsyncValues = new Map<string, string>();
const mockSecureValues = new Map<string, string>();

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockAsyncValues.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockAsyncValues.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockAsyncValues.delete(key);
    }),
  },
}));

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(
    async (key: string) => mockSecureValues.get(key) ?? null
  ),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureValues.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureValues.delete(key);
  }),
}));

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

const payment = (reference: string): AwaitingPayment => ({
  reference,
  merchantDisplayName: "Corner Shop",
  displayCurrency: "NGN",
  displayAmountMinor: "250000",
  usdcSettlementRaw: "1700000",
  deferredAt: "2026-09-20T03:00:00.000Z",
  expiresAt: "2026-09-20T03:15:00.000Z",
});

describe("pending Payment submissions", () => {
  beforeEach(() => {
    mockAsyncValues.clear();
    mockSecureValues.clear();
  });

  it("restores the exact signed transaction after a process restart", async () => {
    await savePendingPaymentSubmission("did:privy:user-1", {
      payment: payment("pi_one"),
      signedTransactionBase64: "signed-one",
    });

    await expect(
      loadPendingPaymentSubmissions("did:privy:user-1")
    ).resolves.toEqual({
      pi_one: {
        payment: payment("pi_one"),
        signedTransactionBase64: "signed-one",
      },
    });
  });

  it("removes one acknowledged payment without losing another", async () => {
    await savePendingPaymentSubmission("user-1", {
      payment: payment("pi_one"),
      signedTransactionBase64: "signed-one",
    });
    await savePendingPaymentSubmission("user-1", {
      payment: payment("pi_two"),
      signedTransactionBase64: "signed-two",
    });

    await deletePendingPaymentSubmission("user-1", "pi_one");

    await expect(loadPendingPaymentSubmissions("user-1")).resolves.toEqual({
      pi_two: {
        payment: payment("pi_two"),
        signedTransactionBase64: "signed-two",
      },
    });
    expect([...mockSecureValues.values()]).toEqual(["signed-two"]);
  });

  it("prunes metadata whose keychain payload is missing", async () => {
    await savePendingPaymentSubmission("user-1", {
      payment: payment("pi_one"),
      signedTransactionBase64: "signed-one",
    });
    mockSecureValues.clear();

    await expect(loadPendingPaymentSubmissions("user-1")).resolves.toEqual({});
    expect(mockAsyncValues.size).toBe(0);
  });
});

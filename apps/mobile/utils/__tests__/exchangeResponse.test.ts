// The client reaches the device keychain at import time; the schema under
// test does not care, and the node test environment cannot load it.
import { ExchangeResponseSchema } from "../apiClient";

jest.mock("expo-secure-store", () => ({}));

/**
 * The schema is a hand-kept mirror of the backend's `ExchangeResponseSchema`,
 * and a passkey Consumer has no email until they choose to give one. A mirror
 * that still insists on one turns a successful sign-in into "Xend could not
 * start your session" at the network boundary.
 */
describe("ExchangeResponseSchema", () => {
  const response = {
    token: "jwt",
    user: {
      id: "u_1",
      email: null as string | null,
      walletAddress: "SoLAnAaDdRess111111111111111111111111111111",
      isNewUser: true,
    },
  };

  it("accepts a session that carries no email", () => {
    expect(ExchangeResponseSchema.parse(response).user.email).toBeNull();
  });

  it("still accepts one that does", () => {
    const withEmail = {
      ...response,
      user: { ...response.user, email: "a@example.com" },
    };

    expect(ExchangeResponseSchema.parse(withEmail).user.email).toBe(
      "a@example.com"
    );
  });

  it("still refuses a malformed address", () => {
    const bad = {
      ...response,
      user: { ...response.user, email: "not-an-email" },
    };

    expect(() => ExchangeResponseSchema.parse(bad)).toThrow();
  });
});

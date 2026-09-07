// The client reaches the device keychain at import time; the schema under
// test does not care, and the node test environment cannot load it.
import { EmailProofResponseSchema } from "../apiClient";

jest.mock("expo-secure-store", () => ({}));

/**
 * The schema is a hand-kept mirror of the backend's `EmailProofOutcome`. The
 * two shapes it accepts are the two things a proved inbox can earn, and the
 * `kind` is what the email screen branches on: a mirror that let one through
 * without it would send an existing Consumer into passkey creation.
 */
describe("EmailProofResponseSchema", () => {
  it("accepts a sign-up token for an address nobody held", () => {
    const parsed = EmailProofResponseSchema.parse({
      kind: "signup",
      signupToken: "xsign_abc",
      expiresAt: "2026-08-30T10:15:00.000Z",
    });
    expect(parsed.kind).toBe("signup");
  });

  it("accepts an entry session, with the account it opens on", () => {
    const parsed = EmailProofResponseSchema.parse({
      kind: "entry",
      entryToken: "xentry_abc",
      expiresAt: "2026-08-30T11:00:00.000Z",
      user: {
        id: "u_1",
        email: "a@example.com",
        walletAddress: "SoLAnAaDdRess111111111111111111111111111111",
      },
    });
    expect(parsed.kind).toBe("entry");
    if (parsed.kind === "entry") expect(parsed.user.id).toBe("u_1");
  });

  it("refuses a response that does not say which it is", () => {
    expect(() =>
      EmailProofResponseSchema.parse({
        signupToken: "xsign_abc",
        expiresAt: "2026-08-30T10:15:00.000Z",
      })
    ).toThrow();
  });

  it("refuses an entry session that carries no account", () => {
    expect(() =>
      EmailProofResponseSchema.parse({
        kind: "entry",
        entryToken: "xentry_abc",
        expiresAt: "2026-08-30T11:00:00.000Z",
      })
    ).toThrow();
  });
});

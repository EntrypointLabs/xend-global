import { classifyPasskeyError } from "../passkeyOutcome";

/**
 * The consequence of getting this wrong is not a bad error message.
 *
 * `no-passkey` is what puts "create a new account" in front of someone. Read a
 * cancelled sheet as `no-passkey` on Android and a Consumer who changed their
 * mind is offered a second wallet; read a genuinely empty keychain as
 * `cancelled` and a new Consumer taps the only button on the screen and
 * nothing happens.
 */

/** Shape Expo modules produce: a coded rejection with the native name. */
function nativeError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

describe("classifyPasskeyError", () => {
  describe("Android, which reports the two cases separately", () => {
    it("treats an empty keychain as no-passkey", () => {
      expect(
        classifyPasskeyError(
          nativeError("Passkey Get", "NoCredentials"),
          "android"
        )
      ).toBe("no-passkey");
    });

    it("treats a dismissed sheet as cancelled, never as a new account", () => {
      expect(
        classifyPasskeyError(
          nativeError("Passkey Get", "UserCancelled"),
          "android"
        )
      ).toBe("cancelled");
    });
  });

  describe("iOS, which collapses both into error 1001", () => {
    it("treats a cancel as no-passkey so a new Consumer is never dead-ended", () => {
      expect(
        classifyPasskeyError(
          nativeError("ERR_USER_CANCELLED", "The operation was cancelled."),
          "ios"
        )
      ).toBe("no-passkey");
    });
  });

  describe("everything else is a real failure", () => {
    it("does not offer an account for a credential the server rejected", () => {
      // The orphan-credential case: the platform had something to offer and
      // Privy refused it. Creating an account here would be wrong.
      expect(
        classifyPasskeyError(new Error("invalid_credentials"), "android")
      ).toBe("failed");
    });

    it("does not offer an account when the relying party is misconfigured", () => {
      expect(
        classifyPasskeyError(
          nativeError("Passkey Get", "NotConfigured"),
          "android"
        )
      ).toBe("failed");
    });

    it("survives a thrown non-Error", () => {
      expect(classifyPasskeyError("something odd", "android")).toBe("failed");
      expect(classifyPasskeyError(null, "android")).toBe("failed");
      expect(classifyPasskeyError(undefined, "android")).toBe("failed");
    });

    it("reads the code even when the message carries nothing", () => {
      expect(
        classifyPasskeyError({ code: "NoCredentialException" }, "android")
      ).toBe("no-passkey");
    });
  });
});
